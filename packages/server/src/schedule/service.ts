import type {
  CreateScheduleInput,
  CreateWorktreeInput,
  Schedule,
  ScheduleRun,
  ScheduleRunReason,
  ScheduleSkipReason,
  SessionRef,
  UpdateScheduleInput,
} from "@getpie/contract";
import { MAX_SCHEDULES } from "@getpie/contract";
import { Context, Crypto, Effect, Layer, Semaphore } from "effect";

import {
  InvalidSchedule,
  ProjectNotFound,
  ScheduleLimitReached,
  ScheduleNotFound,
  type StoreReadError,
  type StoreWriteError,
} from "../errors";
import type { GitWorktreeFailure } from "../git/worktree-service";
import { type CreatePiSessionInput, PiAgentSessionService } from "../harness";
import { ProjectService } from "../project";
import { CronError } from "./cron";
import { computeNextRunAt, iso, isStale, validateSpec } from "./next-run";
import { ScheduleRepository } from "./repository";

export type ScheduleStore = {
  readonly list: () => Effect.Effect<ReadonlyArray<Schedule>, StoreReadError>;
  readonly read: (id: string) => Effect.Effect<Schedule, StoreReadError | ScheduleNotFound>;
  readonly write: (schedule: Schedule) => Effect.Effect<void, StoreWriteError>;
  readonly remove: (id: string) => Effect.Effect<void, StoreWriteError>;
};

export type ScheduleProjects = {
  readonly findById: (
    id: string,
  ) => Effect.Effect<{ readonly path: string }, StoreReadError | ProjectNotFound>;
};

export type ScheduleSessions = {
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
  readonly schedule: Schedule;
  readonly ref?: SessionRef;
};

type FireSessionOutcome =
  | { readonly kind: "started"; readonly ref: SessionRef }
  | { readonly kind: "skipped"; readonly skipReason: ScheduleSkipReason }
  | { readonly kind: "failed"; readonly error: string };

export type ScheduleServiceShape = {
  readonly list: () => Effect.Effect<ReadonlyArray<Schedule>, StoreReadError>;
  readonly get: (id: string) => Effect.Effect<Schedule, StoreReadError | ScheduleNotFound>;
  readonly create: (
    input: CreateScheduleInput,
  ) => Effect.Effect<
    Schedule,
    StoreReadError | StoreWriteError | ProjectNotFound | InvalidSchedule | ScheduleLimitReached
  >;
  readonly update: (
    input: UpdateScheduleInput,
  ) => Effect.Effect<
    Schedule,
    StoreReadError | StoreWriteError | ScheduleNotFound | InvalidSchedule
  >;
  readonly delete: (
    id: string,
  ) => Effect.Effect<void, StoreReadError | StoreWriteError | ScheduleNotFound>;
  readonly runNow: (
    id: string,
  ) => Effect.Effect<FireResult, StoreReadError | StoreWriteError | ScheduleNotFound>;
  readonly tick: () => Effect.Effect<void, StoreReadError | StoreWriteError>;
};

export class ScheduleService extends Context.Service<ScheduleService, ScheduleServiceShape>()(
  "ScheduleService",
) {}

const compareSchedules = (a: Schedule, b: Schedule): number => {
  if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
  if (a.nextRunAt === null && b.nextRunAt === null) return a.name.localeCompare(b.name);
  if (a.nextRunAt === null) return 1;
  if (b.nextRunAt === null) return -1;
  const byRun = a.nextRunAt.localeCompare(b.nextRunAt);
  return byRun !== 0 ? byRun : a.name.localeCompare(b.name);
};

const compareDue = (a: Schedule, b: Schedule): number => {
  const an = a.nextRunAt ?? "";
  const bn = b.nextRunAt ?? "";
  if (an !== bn) return an.localeCompare(bn);
  return a.id.localeCompare(b.id);
};

const titleFromName = (name: string): string =>
  name.length > TITLE_CHARS ? name.slice(0, TITLE_CHARS) : name;

const appendRun = (schedule: Schedule, run: ScheduleRun, nowIso: string): Schedule => ({
  ...schedule,
  updatedAt: nowIso,
  lastRunAt: run.startedAt,
  lastRunStatus: run.status,
  ...(run.sessionId !== undefined ? { lastSessionId: run.sessionId } : undefined),
  ...(run.status === "failed" && run.error !== undefined ? { lastError: run.error } : undefined),
  runs: [run, ...schedule.runs].slice(0, MAX_RUNS),
});

const tryValidate = (spec: Schedule["spec"], now: number): Effect.Effect<void, InvalidSchedule> =>
  Effect.try({
    try: () => validateSpec(spec, now),
    catch: (error) =>
      new InvalidSchedule({
        reason:
          error instanceof CronError || error instanceof Error ? error.message : String(error),
      }),
  });

const tryNextRun = (
  spec: Schedule["spec"],
  id: string,
  now: number,
): Effect.Effect<number | null, InvalidSchedule> =>
  Effect.try({
    try: () => computeNextRunAt(spec, id, now),
    catch: (error) =>
      new InvalidSchedule({
        reason:
          error instanceof CronError || error instanceof Error ? error.message : String(error),
      }),
  });

export const makeScheduleService = (deps: {
  readonly repo: ScheduleStore;
  readonly projects: ScheduleProjects;
  readonly sessions: ScheduleSessions;
  readonly newId: Effect.Effect<string>;
  readonly now: () => number;
}): ScheduleServiceShape => {
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
    schedule: Schedule,
  ): Effect.Effect<
    SessionRef,
    ProjectNotFound | StoreReadError | StoreWriteError | GitWorktreeFailure
  > =>
    Effect.gen(function* () {
      const project = yield* projects.findById(schedule.projectId);
      const created = yield* sessions.create({
        projectId: schedule.projectId,
        cwd: project.path,
        title: titleFromName(schedule.name),
        scheduleId: schedule.id,
        ...(schedule.provider !== undefined && schedule.modelId !== undefined
          ? { model: { provider: schedule.provider, modelId: schedule.modelId } }
          : undefined),
        ...(schedule.worktree !== undefined ? { worktree: schedule.worktree } : undefined),
      });
      // The session is already durable. A prompt failure is logged; the user
      // can open the session and retry. Do not roll the create back.
      yield* sessions
        .prompt({
          ref: created.ref,
          parts: [{ type: "text", text: schedule.prompt }],
        })
        .pipe(
          Effect.catch((error) =>
            Effect.logWarning("schedule prompt failed").pipe(
              Effect.annotateLogs({
                event: "schedule.prompt_failed",
                scheduleId: schedule.id,
                sessionId: created.ref.sessionId,
                error: String(error),
              }),
            ),
          ),
        );
      return created.ref;
    });

  const persistAdvance = (schedule: Schedule, firedAt: number, disableOnce: boolean) =>
    tryNextRun(schedule.spec, schedule.id, firedAt).pipe(
      Effect.map((next) => ({
        ...schedule,
        enabled: disableOnce ? false : schedule.enabled,
        nextRunAt: disableOnce ? null : iso(next),
      })),
      Effect.catchTag("InvalidSchedule", () =>
        Effect.succeed({
          ...schedule,
          enabled: false,
          nextRunAt: null,
        }),
      ),
    );

  const record = (schedule: Schedule, run: ScheduleRun, firedAt: number, disableOnce: boolean) =>
    persistAdvance(appendRun(schedule, run, new Date(firedAt).toISOString()), firedAt, disableOnce);

  const fire = (
    schedule: Schedule,
    reason: ScheduleRunReason,
    options: { readonly skipIfLive: boolean },
  ): Effect.Effect<FireResult, StoreReadError | StoreWriteError> =>
    Effect.gen(function* () {
      const startedAt = now();
      const runId = yield* newId;
      const startedIso = new Date(startedAt).toISOString();

      if (inFlight.has(schedule.id)) {
        const skipped = yield* record(
          schedule,
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
        return { schedule: skipped };
      }

      if (options.skipIfLive && schedule.lastSessionId !== undefined) {
        const live = yield* isLive(schedule.lastSessionId, schedule.projectId);
        if (live) {
          const skipped = yield* record(
            schedule,
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
          return { schedule: skipped };
        }
      }

      inFlight.add(schedule.id);
      const outcome: FireSessionOutcome = yield* fireSession(schedule).pipe(
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
        Effect.ensuring(Effect.sync(() => inFlight.delete(schedule.id))),
      );

      if (outcome.kind === "skipped") {
        const skipped = yield* record(
          schedule,
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
        return { schedule: skipped };
      }

      if (outcome.kind === "failed") {
        const failed = yield* record(
          schedule,
          {
            id: runId,
            startedAt: startedIso,
            reason,
            status: "failed",
            error: outcome.error,
          },
          startedAt,
          schedule.spec.kind === "once",
        );
        yield* repo.write(failed);
        return { schedule: failed };
      }

      const started = yield* record(
        schedule,
        {
          id: runId,
          startedAt: startedIso,
          reason,
          status: "started",
          sessionId: outcome.ref.sessionId,
        },
        startedAt,
        schedule.spec.kind === "once",
      );
      yield* repo.write(started);
      yield* Effect.logInfo("schedule fired").pipe(
        Effect.annotateLogs({
          event: "schedule.fired",
          scheduleId: schedule.id,
          sessionId: outcome.ref.sessionId,
          reason,
        }),
      );
      return { schedule: started, ref: outcome.ref };
    });

  return {
    list: () =>
      repo.list().pipe(Effect.map((schedules) => Array.from(schedules).sort(compareSchedules))),

    get: (id) => repo.read(id),

    create: (input) =>
      Effect.gen(function* () {
        yield* projects.findById(input.projectId);
        const createdAt = now();
        yield* tryValidate(input.spec, createdAt);
        const existing = yield* repo.list();
        if (existing.length >= MAX_SCHEDULES) {
          return yield* Effect.fail(new ScheduleLimitReached({ limit: MAX_SCHEDULES }));
        }
        const id = yield* newId;
        const next = yield* tryNextRun(input.spec, id, createdAt);
        const createdIso = new Date(createdAt).toISOString();
        const worktree: CreateWorktreeInput | undefined = input.worktree;
        const schedule: Schedule = {
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
        yield* repo.write(schedule);
        yield* Effect.logInfo("schedule created").pipe(
          Effect.annotateLogs({ event: "schedule.created", scheduleId: id }),
        );
        return schedule;
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
        const updated: Schedule = {
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
            Effect.logInfo("schedule deleted").pipe(
              Effect.annotateLogs({ event: "schedule.deleted", scheduleId: id }),
            ),
          ),
        ),

    runNow: (id) =>
      repo
        .read(id)
        .pipe(Effect.flatMap((schedule) => fire(schedule, "manual", { skipIfLive: false }))),

    tick: () =>
      tickGate.withPermit(
        Effect.gen(function* () {
          const tickedAt = now();
          const schedules = yield* repo.list();
          const due = schedules
            .filter(
              (schedule) =>
                schedule.enabled &&
                schedule.nextRunAt !== null &&
                Date.parse(schedule.nextRunAt) <= tickedAt,
            )
            .sort(compareDue);

          yield* Effect.forEach(
            due,
            (schedule) =>
              Effect.gen(function* () {
                const nextRunMs = Date.parse(schedule.nextRunAt!);
                if (isStale(nextRunMs, tickedAt)) {
                  const runId = yield* newId;
                  const skipped = yield* record(
                    schedule,
                    {
                      id: runId,
                      startedAt: new Date(tickedAt).toISOString(),
                      reason: "scheduled",
                      status: "skipped",
                      skipReason: "stale",
                    },
                    tickedAt,
                    schedule.spec.kind === "once",
                  );
                  yield* repo.write(skipped);
                  return;
                }
                const reason: ScheduleRunReason =
                  tickedAt - nextRunMs > 60_000 ? "catch_up" : "scheduled";
                yield* fire(schedule, reason, { skipIfLive: true });
              }),
            { concurrency: 1, discard: true },
          );
        }),
      ),
  };
};

export const ScheduleServiceLayer: Layer.Layer<
  ScheduleService,
  never,
  ScheduleRepository | ProjectService | PiAgentSessionService | Crypto.Crypto
> = Layer.effect(
  ScheduleService,
  Effect.gen(function* () {
    const repo = yield* ScheduleRepository;
    const projects = yield* ProjectService;
    const sessions = yield* PiAgentSessionService;
    const crypto = yield* Crypto.Crypto;
    return makeScheduleService({
      repo,
      projects,
      sessions,
      newId: crypto.randomUUIDv4.pipe(
        Effect.catchTag("PlatformError", (cause) =>
          Effect.die(new Error("invariant: platform RNG failed minting a schedule id", { cause })),
        ),
      ),
      now: () => Date.now(),
    });
  }),
);
