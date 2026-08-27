import type {
  CreateAutomationInput,
  CreateWorktreeInput,
  Automation,
  AutomationRun,
  AutomationRunReason,
  AutomationSkipReason,
  SessionRef,
  UpdateAutomationInput,
} from "@getpie/contract";
import { MAX_AUTOMATIONS } from "@getpie/contract";
import { Context, Crypto, Effect, Layer, Semaphore } from "effect";

import {
  InvalidAutomation,
  ProjectNotFound,
  AutomationLimitReached,
  AutomationNotFound,
  type StoreReadError,
  type StoreWriteError,
} from "../errors";
import type { GitWorktreeFailure } from "../git/worktree-service";
import { type CreatePiSessionInput, PiAgentSessionService } from "../harness";
import { ProjectService } from "../project";
import { CronError } from "./cron";
import { computeNextRunAt, iso, isStale, validateSpec } from "./next-run";
import { AutomationRepository } from "./repository";

export type AutomationStore = {
  readonly list: () => Effect.Effect<ReadonlyArray<Automation>, StoreReadError>;
  readonly read: (id: string) => Effect.Effect<Automation, StoreReadError | AutomationNotFound>;
  readonly write: (automation: Automation) => Effect.Effect<void, StoreWriteError>;
  readonly remove: (id: string) => Effect.Effect<void, StoreWriteError>;
};

export type AutomationProjects = {
  readonly findById: (
    id: string,
  ) => Effect.Effect<{ readonly path: string }, StoreReadError | ProjectNotFound>;
};

export type AutomationSessions = {
  readonly create: (
    input: CreatePiSessionInput,
  ) => Effect.Effect<
    { readonly ref: SessionRef; readonly workspace: { readonly cwd: string } },
    StoreWriteError | GitWorktreeFailure
  >;
  readonly prompt: (input: {
    readonly ref: SessionRef;
    readonly parts: ReadonlyArray<{ readonly type: "text"; readonly text: string }>;
  }) => Effect.Effect<unknown, unknown>;
  readonly getStatus: (
    ref: SessionRef,
  ) => Effect.Effect<{ readonly phase: "idle" | "running" | "requires_action" | "crashed" }>;
};

const MAX_RUNS = 20;
const TITLE_CHARS = 60;

export type FireResult = {
  readonly automation: Automation;
  readonly ref?: SessionRef;
};

type FireSessionOutcome =
  | { readonly kind: "started"; readonly ref: SessionRef }
  | { readonly kind: "skipped"; readonly skipReason: AutomationSkipReason }
  | { readonly kind: "failed"; readonly error: string };

export type AutomationServiceShape = {
  readonly list: () => Effect.Effect<ReadonlyArray<Automation>, StoreReadError>;
  readonly get: (id: string) => Effect.Effect<Automation, StoreReadError | AutomationNotFound>;
  readonly create: (
    input: CreateAutomationInput,
  ) => Effect.Effect<
    Automation,
    StoreReadError | StoreWriteError | ProjectNotFound | InvalidAutomation | AutomationLimitReached
  >;
  readonly update: (
    input: UpdateAutomationInput,
  ) => Effect.Effect<
    Automation,
    StoreReadError | StoreWriteError | AutomationNotFound | InvalidAutomation
  >;
  readonly delete: (
    id: string,
  ) => Effect.Effect<void, StoreReadError | StoreWriteError | AutomationNotFound>;
  readonly runNow: (
    id: string,
  ) => Effect.Effect<FireResult, StoreReadError | StoreWriteError | AutomationNotFound>;
  readonly tick: () => Effect.Effect<void, StoreReadError | StoreWriteError>;
};

export class AutomationService extends Context.Service<AutomationService, AutomationServiceShape>()(
  "AutomationService",
) {}

const compareAutomations = (a: Automation, b: Automation): number => {
  if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
  if (a.nextRunAt === null && b.nextRunAt === null) return a.name.localeCompare(b.name);
  if (a.nextRunAt === null) return 1;
  if (b.nextRunAt === null) return -1;
  const byRun = a.nextRunAt.localeCompare(b.nextRunAt);
  return byRun !== 0 ? byRun : a.name.localeCompare(b.name);
};

const compareDue = (a: Automation, b: Automation): number => {
  const an = a.nextRunAt ?? "";
  const bn = b.nextRunAt ?? "";
  if (an !== bn) return an.localeCompare(bn);
  return a.id.localeCompare(b.id);
};

const titleFromName = (name: string): string =>
  name.length > TITLE_CHARS ? name.slice(0, TITLE_CHARS) : name;

const appendRun = (automation: Automation, run: AutomationRun, nowIso: string): Automation => ({
  ...automation,
  updatedAt: nowIso,
  lastRunAt: run.startedAt,
  lastRunStatus: run.status,
  ...(run.sessionId !== undefined ? { lastSessionId: run.sessionId } : undefined),
  ...(run.status === "failed" && run.error !== undefined ? { lastError: run.error } : undefined),
  runs: [run, ...automation.runs].slice(0, MAX_RUNS),
});

const tryValidate = (
  spec: Automation["spec"],
  now: number,
): Effect.Effect<void, InvalidAutomation> =>
  Effect.try({
    try: () => validateSpec(spec, now),
    catch: (error) =>
      new InvalidAutomation({
        reason:
          error instanceof CronError || error instanceof Error ? error.message : String(error),
      }),
  });

const tryNextRun = (
  spec: Automation["spec"],
  id: string,
  now: number,
): Effect.Effect<number | null, InvalidAutomation> =>
  Effect.try({
    try: () => computeNextRunAt(spec, id, now),
    catch: (error) =>
      new InvalidAutomation({
        reason:
          error instanceof CronError || error instanceof Error ? error.message : String(error),
      }),
  });

export const makeAutomationService = (deps: {
  readonly repo: AutomationStore;
  readonly projects: AutomationProjects;
  readonly sessions: AutomationSessions;
  readonly newId: Effect.Effect<string>;
  readonly now: () => number;
}): AutomationServiceShape => {
  const { repo, projects, sessions, newId, now } = deps;
  const tickGate = Semaphore.makeUnsafe(1);
  const inFlight = new Set<string>();

  const isLive = (sessionId: string, projectId: string) =>
    sessions
      .getStatus({ projectId, sessionId })
      .pipe(
        Effect.map((status) => status.phase === "running" || status.phase === "requires_action"),
      );

  const fireSession = (
    automation: Automation,
  ): Effect.Effect<
    SessionRef,
    ProjectNotFound | StoreReadError | StoreWriteError | GitWorktreeFailure
  > =>
    Effect.gen(function* () {
      const project = yield* projects.findById(automation.projectId);
      const created = yield* sessions.create({
        projectId: automation.projectId,
        cwd: project.path,
        title: titleFromName(automation.name),
        automationId: automation.id,
        ...(automation.provider !== undefined && automation.modelId !== undefined
          ? { model: { provider: automation.provider, modelId: automation.modelId } }
          : undefined),
        ...(automation.worktree !== undefined ? { worktree: automation.worktree } : undefined),
      });
      // The session is already durable. Kick the prompt off the fire path so a
      // slow or wedged Pi cannot stall runNow or the tick. Failures are logged;
      // the user can open the session and retry.
      yield* sessions
        .prompt({
          ref: created.ref,
          parts: [{ type: "text", text: automation.prompt }],
        })
        .pipe(
          Effect.catch((error) =>
            Effect.logWarning("automation prompt failed").pipe(
              Effect.annotateLogs({
                event: "automation.prompt_failed",
                automationId: automation.id,
                sessionId: created.ref.sessionId,
                error: String(error),
              }),
            ),
          ),
          Effect.forkDetach,
        );
      return created.ref;
    });

  const persistAdvance = (automation: Automation, firedAt: number, disableOnce: boolean) =>
    tryNextRun(automation.spec, automation.id, firedAt).pipe(
      Effect.map((next) => ({
        ...automation,
        enabled: disableOnce ? false : automation.enabled,
        nextRunAt: disableOnce ? null : iso(next),
      })),
      Effect.catchTag("InvalidAutomation", () =>
        Effect.succeed({
          ...automation,
          enabled: false,
          nextRunAt: null,
        }),
      ),
    );

  const record = (
    automation: Automation,
    run: AutomationRun,
    firedAt: number,
    disableOnce: boolean,
  ) =>
    persistAdvance(
      appendRun(automation, run, new Date(firedAt).toISOString()),
      firedAt,
      disableOnce,
    );

  const fire = (
    automation: Automation,
    reason: AutomationRunReason,
    options: { readonly skipIfLive: boolean },
  ): Effect.Effect<FireResult, StoreReadError | StoreWriteError> =>
    Effect.gen(function* () {
      const startedAt = now();
      const runId = yield* newId;
      const startedIso = new Date(startedAt).toISOString();

      if (inFlight.has(automation.id)) {
        const skipped = yield* record(
          automation,
          {
            id: runId,
            startedAt: startedIso,
            reason,
            status: "skipped",
            skipReason: "in_progress",
          },
          startedAt,
          false,
        );
        yield* repo.write(skipped);
        return { automation: skipped };
      }

      if (options.skipIfLive && automation.lastSessionId !== undefined) {
        const live = yield* isLive(automation.lastSessionId, automation.projectId);
        if (live) {
          const skipped = yield* record(
            automation,
            {
              id: runId,
              startedAt: startedIso,
              reason,
              status: "skipped",
              skipReason: "in_progress",
            },
            startedAt,
            false,
          );
          yield* repo.write(skipped);
          return { automation: skipped };
        }
      }

      inFlight.add(automation.id);
      const outcome: FireSessionOutcome = yield* fireSession(automation).pipe(
        Effect.map(
          (ref): FireSessionOutcome => ({
            kind: "started",
            ref,
          }),
        ),
        Effect.catchTag("ProjectNotFound", () =>
          Effect.succeed({
            kind: "skipped",
            skipReason: "project_missing",
          } satisfies FireSessionOutcome),
        ),
        Effect.catch((error) =>
          Effect.succeed({
            kind: "failed",
            error: error instanceof Error ? error.message : String(error),
          } satisfies FireSessionOutcome),
        ),
        Effect.ensuring(Effect.sync(() => inFlight.delete(automation.id))),
      );

      if (outcome.kind === "skipped") {
        const skipped = yield* record(
          automation,
          {
            id: runId,
            startedAt: startedIso,
            reason,
            status: "skipped",
            skipReason: outcome.skipReason,
          },
          startedAt,
          false,
        );
        yield* repo.write(skipped);
        return { automation: skipped };
      }

      if (outcome.kind === "failed") {
        const failed = yield* record(
          automation,
          {
            id: runId,
            startedAt: startedIso,
            reason,
            status: "failed",
            error: outcome.error,
          },
          startedAt,
          automation.spec.kind === "once",
        );
        yield* repo.write(failed);
        return { automation: failed };
      }

      const started = yield* record(
        automation,
        {
          id: runId,
          startedAt: startedIso,
          reason,
          status: "started",
          sessionId: outcome.ref.sessionId,
        },
        startedAt,
        automation.spec.kind === "once",
      );
      yield* repo.write(started);
      yield* Effect.logInfo("automation fired").pipe(
        Effect.annotateLogs({
          event: "automation.fired",
          automationId: automation.id,
          sessionId: outcome.ref.sessionId,
          reason,
        }),
      );
      return { automation: started, ref: outcome.ref };
    });

  return {
    list: () =>
      repo
        .list()
        .pipe(Effect.map((automations) => Array.from(automations).sort(compareAutomations))),

    get: (id) => repo.read(id),

    create: (input) =>
      Effect.gen(function* () {
        yield* projects.findById(input.projectId);
        const createdAt = now();
        yield* tryValidate(input.spec, createdAt);
        const existing = yield* repo.list();
        if (existing.length >= MAX_AUTOMATIONS) {
          return yield* Effect.fail(new AutomationLimitReached({ limit: MAX_AUTOMATIONS }));
        }
        const id = yield* newId;
        const next = yield* tryNextRun(input.spec, id, createdAt);
        const createdIso = new Date(createdAt).toISOString();
        const worktree: CreateWorktreeInput | undefined = input.worktree;
        const automation: Automation = {
          id,
          name: input.name,
          projectId: input.projectId,
          prompt: input.prompt,
          spec: input.spec,
          enabled: input.enabled ?? true,
          createdAt: createdIso,
          updatedAt: createdIso,
          nextRunAt: iso(next),
          runs: [],
          ...(worktree !== undefined ? { worktree } : undefined),
          ...(input.provider !== undefined ? { provider: input.provider } : undefined),
          ...(input.modelId !== undefined ? { modelId: input.modelId } : undefined),
        };
        yield* repo.write(automation);
        yield* Effect.logInfo("automation created").pipe(
          Effect.annotateLogs({ event: "automation.created", automationId: id }),
        );
        return automation;
      }),

    update: (input) =>
      Effect.gen(function* () {
        const current = yield* repo.read(input.id);
        const updatedAt = now();
        const spec = input.spec ?? current.spec;
        if (input.spec !== undefined) yield* tryValidate(spec, updatedAt);
        const next = yield* tryNextRun(spec, current.id, updatedAt);
        const worktree = input.worktree ?? current.worktree;
        const provider = input.provider ?? current.provider;
        const modelId = input.modelId ?? current.modelId;
        const updated: Automation = {
          ...current,
          name: input.name ?? current.name,
          prompt: input.prompt ?? current.prompt,
          spec,
          enabled: input.enabled ?? current.enabled,
          updatedAt: new Date(updatedAt).toISOString(),
          nextRunAt: iso(next),
          ...(worktree !== undefined ? { worktree } : undefined),
          ...(provider !== undefined ? { provider } : undefined),
          ...(modelId !== undefined ? { modelId } : undefined),
        };
        yield* repo.write(updated);
        return updated;
      }),

    delete: (id) =>
      repo
        .read(id)
        .pipe(
          Effect.andThen(repo.remove(id)),
          Effect.andThen(
            Effect.logInfo("automation deleted").pipe(
              Effect.annotateLogs({ event: "automation.deleted", automationId: id }),
            ),
          ),
        ),

    runNow: (id) =>
      repo
        .read(id)
        .pipe(Effect.flatMap((automation) => fire(automation, "manual", { skipIfLive: false }))),

    tick: () =>
      tickGate.withPermit(
        Effect.gen(function* () {
          const tickedAt = now();
          const automations = yield* repo.list();
          const due = automations
            .filter(
              (automation) =>
                automation.enabled &&
                automation.nextRunAt !== null &&
                Date.parse(automation.nextRunAt) <= tickedAt,
            )
            .sort(compareDue);

          yield* Effect.forEach(
            due,
            (automation) =>
              Effect.gen(function* () {
                const nextRunMs = Date.parse(automation.nextRunAt!);
                if (isStale(nextRunMs, tickedAt)) {
                  const runId = yield* newId;
                  const skipped = yield* record(
                    automation,
                    {
                      id: runId,
                      startedAt: new Date(tickedAt).toISOString(),
                      reason: "scheduled",
                      status: "skipped",
                      skipReason: "stale",
                    },
                    tickedAt,
                    automation.spec.kind === "once",
                  );
                  yield* repo.write(skipped);
                  return;
                }
                const reason: AutomationRunReason =
                  tickedAt - nextRunMs > 60_000 ? "catch_up" : "scheduled";
                yield* fire(automation, reason, { skipIfLive: true });
              }),
            { concurrency: 1, discard: true },
          );
        }),
      ),
  };
};

export const AutomationServiceLayer: Layer.Layer<
  AutomationService,
  never,
  AutomationRepository | ProjectService | PiAgentSessionService | Crypto.Crypto
> = Layer.effect(
  AutomationService,
  Effect.gen(function* () {
    const repo = yield* AutomationRepository;
    const projects = yield* ProjectService;
    const sessions = yield* PiAgentSessionService;
    const crypto = yield* Crypto.Crypto;
    return makeAutomationService({
      repo,
      projects,
      sessions,
      newId: crypto.randomUUIDv4.pipe(
        Effect.catchTag("PlatformError", (cause) =>
          Effect.die(
            new Error("invariant: platform RNG failed minting an automation id", { cause }),
          ),
        ),
      ),
      now: () => Date.now(),
    });
  }),
);
