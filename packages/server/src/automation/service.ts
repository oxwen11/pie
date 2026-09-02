import type {
  Automation,
  AutomationPauseReason,
  AutomationRun,
  AutomationRunReason,
  AutomationRunSnapshot,
  AutomationSession,
  AutomationSkipReason,
  CreateAutomationInput,
  CreateWorktreeInput,
  SessionPhase,
  SessionRef,
  UpdateAutomationInput,
} from "@getpie/contract";
import {
  AUTOMATION_CIRCUIT_FAILURES,
  automationSessionOf,
  countsTowardMaxRuns,
  firedRunCount,
  MAX_AUTOMATIONS,
  persistAutomationSession,
  reachedMaxRuns,
  reuseSessionIdOf,
} from "@getpie/contract";
import { Context, Crypto, Effect, Layer, Result, Semaphore } from "effect";

import {
  InvalidAutomation,
  ProjectNotFound,
  AutomationLimitReached,
  AutomationNotFound,
  type StoreReadError,
  type StoreWriteError,
} from "../errors";
import type { GitWorktreeFailure } from "../git/worktree-service";
import {
  type CreatePiSessionInput,
  type PiAgentSessionServiceShape,
  PiAgentSessionService,
} from "../harness";
import { ProjectService } from "../project";
import { CronError } from "./cron";
import {
  computeNextRunAt,
  countMissedSlots,
  iso,
  isLate,
  isStale,
  nextWakeDelayMs,
  validateExpiresAt,
  validateSpec,
} from "./next-run";
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

export type FoundSession = {
  readonly archived: boolean;
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
  readonly getStatus: (ref: SessionRef) => Effect.Effect<{ readonly phase: SessionPhase }>;
  readonly find: (ref: SessionRef) => Effect.Effect<FoundSession | null, StoreReadError>;
  readonly waitUntilSettled: (ref: SessionRef) => Effect.Effect<{ readonly phase: SessionPhase }>;
};

const MAX_RUNS = 20;
const TITLE_CHARS = 60;

export type FireResult = {
  readonly automation: Automation;
  readonly ref?: SessionRef;
};

type FireSessionOutcome =
  | { readonly kind: "ready"; readonly ref: SessionRef }
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
  readonly recover: () => Effect.Effect<void, StoreReadError | StoreWriteError>;
  readonly nextWakeDelay: () => Effect.Effect<number, StoreReadError>;
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

const snapshotOf = (automation: Automation): AutomationRunSnapshot => ({
  name: automation.name,
  prompt: automation.prompt,
  projectId: automation.projectId,
  spec: automation.spec,
  session: automationSessionOf(automation),
  ...(automation.worktree !== undefined ? { worktree: automation.worktree } : undefined),
  ...(automation.provider !== undefined ? { provider: automation.provider } : undefined),
  ...(automation.modelId !== undefined ? { modelId: automation.modelId } : undefined),
});

const withoutLastError = (automation: Automation): Omit<Automation, "lastError"> => {
  const { lastError: _lastError, ...rest } = automation;
  return rest;
};

const appendRun = (automation: Automation, run: AutomationRun, nowIso: string): Automation => {
  const nextFiredCount = countsTowardMaxRuns(run.status)
    ? firedRunCount(automation) + 1
    : automation.firedCount;
  return {
    ...withoutLastError(automation),
    updatedAt: nowIso,
    lastRunAt: run.startedAt,
    lastRunStatus: run.status,
    runs: [run, ...automation.runs].slice(0, MAX_RUNS),
    ...(nextFiredCount !== undefined ? { firedCount: nextFiredCount } : undefined),
    ...(run.sessionId !== undefined ? { lastSessionId: run.sessionId } : undefined),
    ...(run.status === "failed" && run.error !== undefined ? { lastError: run.error } : undefined),
  };
};

const patchRun = (
  automation: Automation,
  runId: string,
  patch: Partial<AutomationRun>,
  nowIso: string,
): Automation => {
  const runs = automation.runs.map((run) => (run.id === runId ? { ...run, ...patch } : run));
  const current = runs.find((run) => run.id === runId);
  if (current === undefined) return automation;
  return {
    ...withoutLastError(automation),
    updatedAt: nowIso,
    runs,
    lastRunStatus: current.status,
    ...(current.sessionId !== undefined ? { lastSessionId: current.sessionId } : undefined),
    ...(current.status === "failed" && current.error !== undefined
      ? { lastError: current.error }
      : undefined),
  };
};

const tryValidate = (
  spec: Automation["spec"],
  now: number,
  expiresAt?: string,
): Effect.Effect<void, InvalidAutomation> =>
  Effect.try({
    try: () => {
      validateSpec(spec, now);
      validateExpiresAt(expiresAt, now);
    },
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

const isBusy = (phase: SessionPhase): boolean => phase === "running" || phase === "requires_action";

const logAutomation = (entry: {
  readonly event: string;
  readonly message: string;
  readonly level?: "info" | "warn";
  readonly annotations?: Record<string, unknown>;
}): Effect.Effect<void> => {
  const log =
    entry.level === "warn" ? Effect.logWarning(entry.message) : Effect.logInfo(entry.message);
  return log.pipe(Effect.annotateLogs({ event: entry.event, ...entry.annotations }));
};

export const makeAutomationService = (deps: {
  readonly repo: AutomationStore;
  readonly projects: AutomationProjects;
  readonly sessions: AutomationSessions;
  readonly newId: Effect.Effect<string>;
  readonly now: () => number;
  readonly forkSettle?: (effect: Effect.Effect<void>) => Effect.Effect<void>;
}): AutomationServiceShape => {
  const { repo, projects, sessions, newId, now } = deps;
  const forkSettle = deps.forkSettle ?? ((effect) => effect.pipe(Effect.forkDetach, Effect.asVoid));
  const tickGate = Semaphore.makeUnsafe(1);
  const inFlight = new Set<string>();

  const persistAdvance = (
    automation: Automation,
    firedAt: number,
    disableOnce: boolean,
    pauseReason?: AutomationPauseReason,
  ): Effect.Effect<Automation> =>
    tryNextRun(automation.spec, automation.id, firedAt).pipe(
      Effect.map((next) => ({
        ...automation,
        enabled: disableOnce || pauseReason !== undefined ? false : automation.enabled,
        nextRunAt: disableOnce || pauseReason !== undefined ? null : iso(next),
        ...(pauseReason !== undefined ? { pauseReason } : undefined),
      })),
      Effect.catchTag("InvalidAutomation", () =>
        Effect.succeed({
          ...automation,
          enabled: false,
          nextRunAt: null,
          pauseReason: "invalid_spec" as const,
        }),
      ),
    );

  const record = (
    automation: Automation,
    run: AutomationRun,
    firedAt: number,
    disableOnce: boolean,
    pauseReason?: AutomationPauseReason,
  ): Effect.Effect<Automation> => {
    const recorded = appendRun(automation, run, new Date(firedAt).toISOString());
    return persistAdvance(
      recorded,
      firedAt,
      disableOnce,
      pauseReason ?? (reachedMaxRuns(recorded) && !disableOnce ? "max_runs" : undefined),
    );
  };

  const finishRun = (
    automationId: string,
    runId: string,
    outcome:
      | { readonly status: "succeeded" }
      | { readonly status: "failed"; readonly error: string },
  ): Effect.Effect<void> =>
    Effect.gen(function* () {
      const current = yield* repo
        .read(automationId)
        .pipe(Effect.catchTag("AutomationNotFound", () => Effect.succeed(null)));
      if (current === null) return;
      const existing = current.runs.find((run) => run.id === runId);
      if (existing?.status !== "running") return;
      const finishedAt = new Date(now()).toISOString();
      const capabilityBlocked =
        outcome.status === "failed" && outcome.error.includes("capability-unavailable");
      const failures =
        outcome.status === "failed" && !capabilityBlocked
          ? (current.consecutiveFailures ?? 0) + 1
          : 0;
      const tripped = outcome.status === "failed" && failures >= AUTOMATION_CIRCUIT_FAILURES;
      const settled: Automation = {
        ...patchRun(
          current,
          runId,
          {
            status: outcome.status,
            finishedAt,
            ...(outcome.status === "failed" ? { error: outcome.error } : undefined),
          },
          finishedAt,
        ),
        consecutiveFailures: failures,
        ...(tripped
          ? {
              enabled: false,
              nextRunAt: null,
              pauseReason: "failureCircuit" as const,
            }
          : undefined),
      };
      const atCap = !tripped && reachedMaxRuns(settled) && settled.enabled;
      const next = atCap
        ? {
            ...settled,
            enabled: false,
            nextRunAt: null,
            pauseReason: "max_runs" as const,
          }
        : settled;
      yield* repo.write(next);
      yield* logAutomation({
        event: "automation.settled",
        message: "automation run settled",
        level: outcome.status === "failed" ? "warn" : "info",
        annotations: {
          automationId,
          runId,
          status: outcome.status,
          ...(existing.sessionId !== undefined ? { sessionId: existing.sessionId } : undefined),
          ...(outcome.status === "failed" ? { error: outcome.error } : undefined),
          consecutiveFailures: failures,
        },
      });
      if (tripped) {
        yield* logAutomation({
          event: "automation.circuit_open",
          message: "automation paused after consecutive failures",
          level: "warn",
          annotations: { automationId, failures },
        });
      } else if (atCap) {
        yield* logAutomation({
          event: "automation.paused",
          message: "automation paused",
          annotations: { automationId, pauseReason: "max_runs" },
        });
      }
    }).pipe(Effect.ignore);

  const settleAfterPrompt = (
    automationId: string,
    runId: string,
    ref: SessionRef,
    prompt: Effect.Effect<unknown, unknown>,
  ): Effect.Effect<void> =>
    Effect.gen(function* () {
      const prompted = yield* prompt.pipe(Effect.result);
      if (Result.isFailure(prompted)) {
        yield* finishRun(automationId, runId, {
          status: "failed",
          error: String(prompted.failure),
        });
        return;
      }
      const status = yield* sessions.waitUntilSettled(ref);
      if (status.phase === "idle") {
        yield* finishRun(automationId, runId, { status: "succeeded" });
        return;
      }
      if (status.phase === "crashed") {
        yield* finishRun(automationId, runId, { status: "failed", error: "session crashed" });
        return;
      }
      yield* finishRun(automationId, runId, {
        status: "failed",
        error: "session did not settle",
      });
    }).pipe(Effect.ensuring(Effect.sync(() => inFlight.delete(automationId))));

  const fireSession = (
    snapshot: AutomationRunSnapshot,
  ): Effect.Effect<
    SessionRef,
    ProjectNotFound | StoreReadError | StoreWriteError | GitWorktreeFailure
  > =>
    Effect.gen(function* () {
      const project = yield* projects.findById(snapshot.projectId);
      const reuseSessionId = reuseSessionIdOf(snapshot.session);
      if (snapshot.session.type === "reuse" && reuseSessionId !== undefined) {
        const ref = { projectId: snapshot.projectId, sessionId: reuseSessionId };
        const found = yield* sessions.find(ref);
        if (found !== null && !found.archived) {
          return ref;
        }
      }
      const created = yield* sessions.create({
        projectId: snapshot.projectId,
        cwd: project.path,
        title: titleFromName(snapshot.name),
        ...(snapshot.provider !== undefined && snapshot.modelId !== undefined
          ? { model: { provider: snapshot.provider, modelId: snapshot.modelId } }
          : undefined),
        ...(snapshot.worktree !== undefined ? { worktree: snapshot.worktree } : undefined),
      });
      return created.ref;
    });

  const fire = (
    automation: Automation,
    reason: AutomationRunReason,
    options: { readonly skipIfBusy: boolean },
  ): Effect.Effect<FireResult, StoreReadError | StoreWriteError> =>
    Effect.gen(function* () {
      const startedAt = now();
      const runId = yield* newId;
      const startedIso = new Date(startedAt).toISOString();
      const snapshot = snapshotOf(automation);
      const disableOnce = snapshot.spec.kind === "once";

      if (reachedMaxRuns(automation)) {
        const skipped = yield* record(
          automation,
          {
            id: runId,
            startedAt: startedIso,
            reason,
            status: "skipped",
            skipReason: "max_runs",
            snapshot,
          },
          startedAt,
          false,
          "max_runs",
        );
        yield* repo.write(skipped);
        yield* logAutomation({
          event: "automation.skipped",
          message: "automation run skipped",
          annotations: {
            automationId: automation.id,
            reason,
            skipReason: "max_runs",
          },
        });
        if (automation.pauseReason !== "max_runs") {
          yield* logAutomation({
            event: "automation.paused",
            message: "automation paused",
            annotations: {
              automationId: automation.id,
              pauseReason: "max_runs",
            },
          });
        }
        return { automation: skipped };
      }

      if (inFlight.has(automation.id) || automation.lastRunStatus === "running") {
        const skipped = yield* record(
          automation,
          {
            id: runId,
            startedAt: startedIso,
            reason,
            status: "missed",
            skipReason: "queue_overflow",
            snapshot,
          },
          startedAt,
          false,
        );
        yield* repo.write(skipped);
        yield* logAutomation({
          event: "automation.missed",
          message: "automation run missed",
          level: "warn",
          annotations: {
            automationId: automation.id,
            reason,
            skipReason: "queue_overflow",
          },
        });
        return { automation: skipped };
      }

      if (options.skipIfBusy && automation.lastSessionId !== undefined) {
        const live = yield* sessions.getStatus({
          projectId: automation.projectId,
          sessionId: automation.lastSessionId,
        });
        if (isBusy(live.phase)) {
          const skipped = yield* record(
            automation,
            {
              id: runId,
              startedAt: startedIso,
              reason,
              status: "skipped",
              skipReason: "in_progress",
              snapshot,
            },
            startedAt,
            false,
          );
          yield* repo.write(skipped);
          yield* logAutomation({
            event: "automation.skipped",
            message: "automation run skipped",
            annotations: {
              automationId: automation.id,
              reason,
              skipReason: "in_progress",
            },
          });
          return { automation: skipped };
        }
      }

      inFlight.add(automation.id);
      const outcome: FireSessionOutcome = yield* fireSession(snapshot).pipe(
        Effect.map((ref): FireSessionOutcome => ({ kind: "ready", ref })),
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
      );

      if (outcome.kind === "skipped") {
        inFlight.delete(automation.id);
        const skipped = yield* record(
          automation,
          {
            id: runId,
            startedAt: startedIso,
            reason,
            status: "skipped",
            skipReason: outcome.skipReason,
            snapshot,
          },
          startedAt,
          false,
          outcome.skipReason === "project_missing" ? "project_missing" : undefined,
        );
        yield* repo.write(skipped);
        yield* logAutomation({
          event: "automation.skipped",
          message: "automation run skipped",
          level: "warn",
          annotations: {
            automationId: automation.id,
            reason,
            skipReason: outcome.skipReason,
          },
        });
        return { automation: skipped };
      }

      if (outcome.kind === "failed") {
        inFlight.delete(automation.id);
        const failed = yield* record(
          automation,
          {
            id: runId,
            startedAt: startedIso,
            reason,
            status: "failed",
            error: outcome.error,
            finishedAt: startedIso,
            snapshot,
          },
          startedAt,
          disableOnce,
        );
        yield* repo.write(failed);
        yield* logAutomation({
          event: "automation.settled",
          message: "automation run settled",
          level: "warn",
          annotations: {
            automationId: automation.id,
            runId,
            status: "failed",
            error: outcome.error,
          },
        });
        if (failed.pauseReason === "max_runs") {
          yield* logAutomation({
            event: "automation.paused",
            message: "automation paused",
            annotations: {
              automationId: automation.id,
              pauseReason: "max_runs",
            },
          });
        }
        return { automation: failed };
      }

      const started = yield* record(
        {
          ...automation,
          ...(snapshot.session.type === "reuse"
            ? { session: { type: "reuse" as const, sessionId: outcome.ref.sessionId } }
            : undefined),
        },
        {
          id: runId,
          startedAt: startedIso,
          reason,
          status: "running",
          sessionId: outcome.ref.sessionId,
          snapshot,
        },
        startedAt,
        disableOnce,
      );
      yield* repo.write(started);
      yield* logAutomation({
        event: "automation.fired",
        message: "automation fired",
        annotations: {
          automationId: automation.id,
          sessionId: outcome.ref.sessionId,
          reason,
          sessionType: snapshot.session.type,
          specKind: snapshot.spec.kind,
        },
      });
      if (started.pauseReason === "max_runs") {
        yield* logAutomation({
          event: "automation.paused",
          message: "automation paused",
          annotations: {
            automationId: automation.id,
            pauseReason: "max_runs",
          },
        });
      }
      const prompt = sessions.prompt({
        ref: outcome.ref,
        parts: [{ type: "text", text: snapshot.prompt }],
      });
      yield* forkSettle(settleAfterPrompt(automation.id, runId, outcome.ref, prompt));
      return { automation: started, ref: outcome.ref };
    });

  const expire = (automation: Automation, tickedAt: number): Effect.Effect<void, StoreWriteError> =>
    Effect.gen(function* () {
      const runId = yield* newId;
      const skipped = yield* record(
        automation,
        {
          id: runId,
          startedAt: new Date(tickedAt).toISOString(),
          reason: "scheduled",
          status: "skipped",
          skipReason: "expired",
        },
        tickedAt,
        true,
        "expired",
      );
      yield* repo.write(skipped);
      yield* logAutomation({
        event: "automation.expired",
        message: "automation expired",
        annotations: { automationId: automation.id },
      });
    });

  const trySession = (
    projectId: string,
    session: AutomationSession | undefined,
  ): Effect.Effect<void, StoreReadError | InvalidAutomation> => {
    const sessionId = session === undefined ? undefined : reuseSessionIdOf(session);
    if (session === undefined || session.type === "new" || sessionId === undefined) {
      return Effect.void;
    }
    return sessions.find({ projectId, sessionId }).pipe(
      Effect.flatMap((found) => {
        if (found === null) {
          return Effect.fail(new InvalidAutomation({ reason: "session not found" }));
        }
        if (found.archived) {
          return Effect.fail(new InvalidAutomation({ reason: "session is archived" }));
        }
        return Effect.void;
      }),
    );
  };

  return {
    list: () =>
      repo
        .list()
        .pipe(Effect.map((automations) => Array.from(automations).sort(compareAutomations))),

    get: (id) => repo.read(id),

    create: (input) =>
      Effect.gen(function* () {
        yield* projects.findById(input.projectId);
        yield* trySession(input.projectId, input.session);
        const createdAt = now();
        yield* tryValidate(input.spec, createdAt, input.expiresAt);
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
          ...persistAutomationSession(input.session),
          ...(input.expiresAt !== undefined ? { expiresAt: input.expiresAt } : undefined),
          ...(input.maxRuns !== undefined ? { maxRuns: input.maxRuns } : undefined),
          ...(worktree !== undefined ? { worktree } : undefined),
          ...(input.provider !== undefined ? { provider: input.provider } : undefined),
          ...(input.modelId !== undefined ? { modelId: input.modelId } : undefined),
        };
        yield* repo.write(automation);
        yield* logAutomation({
          event: "automation.created",
          message: "automation created",
          annotations: {
            automationId: id,
            specKind: input.spec.kind,
            sessionType: automationSessionOf(automation).type,
            ...(input.runNow === true ? { runNow: true } : undefined),
          },
        });
        if (input.runNow === true) {
          const fired = yield* fire(automation, "manual", { skipIfBusy: false });
          return fired.automation;
        }
        return automation;
      }),

    update: (input) =>
      Effect.gen(function* () {
        const current = yield* repo.read(input.id);
        const {
          pauseReason: _pauseReason,
          expiresAt: _expiresAt,
          maxRuns: _maxRuns,
          session: currentSession,
          ...currentRest
        } = current;
        const updatedAt = now();
        const spec = input.spec ?? current.spec;
        const expiresAt =
          input.expiresAt === undefined
            ? current.expiresAt
            : input.expiresAt === null
              ? undefined
              : input.expiresAt;
        const maxRuns =
          input.maxRuns === undefined
            ? current.maxRuns
            : input.maxRuns === null
              ? undefined
              : input.maxRuns;
        if (input.session !== undefined) {
          yield* trySession(current.projectId, input.session);
        }
        if (input.spec !== undefined || input.expiresAt !== undefined || input.enabled === true) {
          yield* tryValidate(spec, updatedAt, expiresAt);
        }
        const next = yield* tryNextRun(spec, current.id, updatedAt);
        const worktree = input.worktree ?? current.worktree;
        const provider = input.provider ?? current.provider;
        const modelId = input.modelId ?? current.modelId;
        const enabled = input.enabled ?? current.enabled;
        const session = input.session ?? currentSession;
        const updated: Automation = {
          ...currentRest,
          name: input.name ?? current.name,
          prompt: input.prompt ?? current.prompt,
          spec,
          enabled,
          updatedAt: new Date(updatedAt).toISOString(),
          nextRunAt: enabled ? iso(next) : current.nextRunAt,
          ...persistAutomationSession(session),
          ...(expiresAt !== undefined ? { expiresAt } : undefined),
          ...(maxRuns !== undefined ? { maxRuns } : undefined),
          ...(worktree !== undefined ? { worktree } : undefined),
          ...(provider !== undefined ? { provider } : undefined),
          ...(modelId !== undefined ? { modelId } : undefined),
          ...(input.enabled === true
            ? { consecutiveFailures: 0 }
            : input.enabled === false
              ? { pauseReason: "manual" as const }
              : current.pauseReason !== undefined
                ? { pauseReason: current.pauseReason }
                : undefined),
        };
        const atCapPause = reachedMaxRuns(updated) && updated.enabled;
        const persisted = atCapPause
          ? {
              ...updated,
              enabled: false,
              nextRunAt: null,
              pauseReason: "max_runs" as const,
            }
          : updated;
        yield* repo.write(persisted);
        yield* logAutomation({
          event: atCapPause
            ? "automation.paused"
            : input.enabled === true
              ? "automation.enabled"
              : input.enabled === false
                ? "automation.paused"
                : "automation.updated",
          message: atCapPause
            ? "automation paused"
            : input.enabled === true
              ? "automation enabled"
              : input.enabled === false
                ? "automation paused"
                : "automation updated",
          annotations: {
            automationId: input.id,
            ...(input.enabled !== undefined ? { enabled: persisted.enabled } : undefined),
            ...(atCapPause
              ? { pauseReason: "max_runs" }
              : input.enabled === false
                ? { pauseReason: "manual" }
                : undefined),
            ...(input.spec !== undefined ? { specKind: spec.kind } : undefined),
          },
        });
        return persisted;
      }),

    delete: (id) =>
      repo.read(id).pipe(
        Effect.andThen(repo.remove(id)),
        Effect.andThen(
          logAutomation({
            event: "automation.deleted",
            message: "automation deleted",
            annotations: { automationId: id },
          }),
        ),
      ),

    runNow: (id) =>
      repo
        .read(id)
        .pipe(Effect.flatMap((automation) => fire(automation, "manual", { skipIfBusy: false }))),

    recover: () =>
      Effect.gen(function* () {
        const tickedAt = now();
        const finishedAt = new Date(tickedAt).toISOString();
        const automations = yield* repo.list();
        let recovered = 0;
        yield* Effect.forEach(
          automations,
          (automation) => {
            const dirty = automation.runs.some((run) => run.status === "running");
            if (!dirty) return Effect.void;
            recovered += 1;
            const next: Automation = {
              ...automation,
              updatedAt: finishedAt,
              lastRunStatus: "interrupted",
              lastError: "app-exit",
              runs: automation.runs.map((run) =>
                run.status === "running"
                  ? { ...run, status: "interrupted" as const, finishedAt, error: "app-exit" }
                  : run,
              ),
            };
            inFlight.delete(automation.id);
            return repo.write(next);
          },
          { concurrency: 1, discard: true },
        );
        if (recovered > 0) {
          yield* logAutomation({
            event: "automation.recovered",
            message: "automation leftover runs marked interrupted",
            annotations: { recovered },
          });
        }
      }),

    nextWakeDelay: () =>
      repo.list().pipe(
        Effect.map((automations) => {
          const tickedAt = now();
          const times: Array<number | null> = [];
          for (const automation of automations) {
            if (!automation.enabled) continue;
            times.push(automation.nextRunAt === null ? null : Date.parse(automation.nextRunAt));
            if (automation.expiresAt !== undefined) times.push(Date.parse(automation.expiresAt));
          }
          return nextWakeDelayMs(times, tickedAt);
        }),
      ),

    tick: () =>
      tickGate.withPermit(
        Effect.gen(function* () {
          const tickedAt = now();
          const automations = yield* repo.list();
          const due = automations
            .filter((automation) => {
              if (!automation.enabled) return false;
              if (
                automation.expiresAt !== undefined &&
                Date.parse(automation.expiresAt) <= tickedAt
              ) {
                return true;
              }
              return automation.nextRunAt !== null && Date.parse(automation.nextRunAt) <= tickedAt;
            })
            .sort(compareDue);

          yield* Effect.forEach(
            due,
            (automation) =>
              Effect.gen(function* () {
                if (
                  automation.expiresAt !== undefined &&
                  Date.parse(automation.expiresAt) <= tickedAt
                ) {
                  yield* expire(automation, tickedAt);
                  return;
                }
                const nextRunMs = Date.parse(automation.nextRunAt!);
                if (isStale(nextRunMs, tickedAt)) {
                  const runId = yield* newId;
                  const missedCount = countMissedSlots(automation.spec, nextRunMs, tickedAt);
                  const missed = yield* record(
                    automation,
                    {
                      id: runId,
                      startedAt: new Date(tickedAt).toISOString(),
                      reason: "scheduled",
                      status: "missed",
                      skipReason: "stale",
                      missedCount,
                    },
                    tickedAt,
                    automation.spec.kind === "once",
                  );
                  yield* repo.write(missed);
                  yield* logAutomation({
                    event: "automation.missed",
                    message: "automation run missed",
                    level: "warn",
                    annotations: {
                      automationId: automation.id,
                      skipReason: "stale",
                      missedCount,
                    },
                  });
                  return;
                }
                if (isLate(nextRunMs, tickedAt)) {
                  const missedCount = countMissedSlots(automation.spec, nextRunMs, tickedAt);
                  const missedId = yield* newId;
                  const withMissed = appendRun(
                    automation,
                    {
                      id: missedId,
                      startedAt: new Date(tickedAt).toISOString(),
                      reason: "scheduled",
                      status: "missed",
                      missedCount,
                    },
                    new Date(tickedAt).toISOString(),
                  );
                  yield* repo.write(withMissed);
                  yield* logAutomation({
                    event: "automation.missed",
                    message: "automation run missed",
                    level: "warn",
                    annotations: {
                      automationId: automation.id,
                      missedCount,
                    },
                  });
                  yield* fire(withMissed, "missed_recovery", { skipIfBusy: true });
                  return;
                }
                yield* fire(automation, "scheduled", { skipIfBusy: true });
              }),
            { concurrency: 1, discard: true },
          );
        }),
      ),
  };
};

const SETTLE_ATTEMPTS = 300;

const waitUntilSettled = (
  sessions: PiAgentSessionServiceShape,
  ref: SessionRef,
): Effect.Effect<{ readonly phase: SessionPhase }> =>
  Effect.gen(function* () {
    for (let attempt = 0; attempt < SETTLE_ATTEMPTS; attempt++) {
      const status = yield* sessions.getStatus(ref);
      if (status.phase === "idle" || status.phase === "crashed") return status;
      yield* Effect.sleep("200 millis");
    }
    return yield* sessions.getStatus(ref);
  });

const findSession = (
  sessions: PiAgentSessionServiceShape,
  ref: SessionRef,
): Effect.Effect<FoundSession | null, StoreReadError> =>
  Effect.gen(function* () {
    const open = yield* sessions.list(ref.projectId, false);
    if (open.some((session) => session.sessionId === ref.sessionId)) {
      return { archived: false };
    }
    const archived = yield* sessions.list(ref.projectId, true);
    if (archived.some((session) => session.sessionId === ref.sessionId)) {
      return { archived: true };
    }
    return null;
  });

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
      sessions: {
        create: (input) => sessions.create(input),
        prompt: (input) => sessions.prompt(input),
        getStatus: (ref) => sessions.getStatus(ref),
        find: (ref) => findSession(sessions, ref),
        waitUntilSettled: (ref) => waitUntilSettled(sessions, ref),
      },
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
