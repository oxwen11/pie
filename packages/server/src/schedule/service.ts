import type {
  Schedule,
  SchedulePauseReason,
  ScheduleRun,
  ScheduleRunReason,
  ScheduleRunSnapshot,
  ScheduleSession,
  ScheduleSkipReason,
  CreateScheduleInput,
  CreateWorktreeInput,
  SessionPhase,
  SessionRef,
  UpdateScheduleInput,
} from "@getpie/contract";
import {
  SCHEDULE_CIRCUIT_FAILURES,
  scheduleSessionOf,
  countsTowardMaxRuns,
  firedRunCount,
  MAX_SCHEDULES,
  persistScheduleSession,
  reachedMaxRuns,
  reuseSessionIdOf,
  bindScheduleSession,
} from "@getpie/contract";
import { Context, Crypto, Effect, Layer, Result, Semaphore } from "effect";

import {
  InvalidSchedule,
  ProjectNotFound,
  ScheduleLimitReached,
  ScheduleNotFound,
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

export type FoundSession = {
  readonly archived: boolean;
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
  readonly getStatus: (ref: SessionRef) => Effect.Effect<{ readonly phase: SessionPhase }>;
  readonly find: (ref: SessionRef) => Effect.Effect<FoundSession | null, StoreReadError>;
  readonly waitUntilSettled: (ref: SessionRef) => Effect.Effect<{ readonly phase: SessionPhase }>;
};

const MAX_RUNS = 20;
const TITLE_CHARS = 60;

export type FireResult = {
  readonly schedule: Schedule;
  readonly ref?: SessionRef;
};

type FireSessionOutcome =
  | { readonly kind: "ready"; readonly ref: SessionRef }
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
  readonly recover: () => Effect.Effect<void, StoreReadError | StoreWriteError>;
  readonly nextWakeDelay: () => Effect.Effect<number, StoreReadError>;
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

const snapshotOf = (schedule: Schedule): ScheduleRunSnapshot => ({
  name: schedule.name,
  prompt: schedule.prompt,
  projectId: schedule.projectId,
  spec: schedule.spec,
  session: scheduleSessionOf(schedule),
  ...(schedule.worktree !== undefined ? { worktree: schedule.worktree } : undefined),
  ...(schedule.provider !== undefined ? { provider: schedule.provider } : undefined),
  ...(schedule.modelId !== undefined ? { modelId: schedule.modelId } : undefined),
});

const withoutLastError = (schedule: Schedule): Omit<Schedule, "lastError"> => {
  const { lastError: _lastError, ...rest } = schedule;
  return rest;
};

const appendRun = (schedule: Schedule, run: ScheduleRun, nowIso: string): Schedule => {
  const nextFiredCount = countsTowardMaxRuns(run.status)
    ? firedRunCount(schedule) + 1
    : schedule.firedCount;
  return {
    ...withoutLastError(schedule),
    updatedAt: nowIso,
    lastRunAt: run.startedAt,
    lastRunStatus: run.status,
    runs: [run, ...schedule.runs].slice(0, MAX_RUNS),
    ...(nextFiredCount !== undefined ? { firedCount: nextFiredCount } : undefined),
    ...(run.sessionId !== undefined ? { lastSessionId: run.sessionId } : undefined),
    ...(run.status === "failed" && run.error !== undefined ? { lastError: run.error } : undefined),
  };
};

const patchRun = (
  schedule: Schedule,
  runId: string,
  patch: Partial<ScheduleRun>,
  nowIso: string,
): Schedule => {
  const runs = schedule.runs.map((run) => (run.id === runId ? { ...run, ...patch } : run));
  const current = runs.find((run) => run.id === runId);
  if (current === undefined) return schedule;
  return {
    ...withoutLastError(schedule),
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
  spec: Schedule["spec"],
  now: number,
  expiresAt?: string,
): Effect.Effect<void, InvalidSchedule> =>
  Effect.try({
    try: () => {
      validateSpec(spec, now);
      validateExpiresAt(expiresAt, now);
    },
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

const isBusy = (phase: SessionPhase): boolean => phase === "running" || phase === "requires_action";

const logSchedule = (entry: {
  readonly event: string;
  readonly message: string;
  readonly level?: "info" | "warn";
  readonly annotations?: Record<string, unknown>;
}): Effect.Effect<void> => {
  const log =
    entry.level === "warn" ? Effect.logWarning(entry.message) : Effect.logInfo(entry.message);
  return log.pipe(Effect.annotateLogs({ event: entry.event, ...entry.annotations }));
};

export const makeScheduleService = (deps: {
  readonly repo: ScheduleStore;
  readonly projects: ScheduleProjects;
  readonly sessions: ScheduleSessions;
  readonly newId: Effect.Effect<string>;
  readonly now: () => number;
  readonly forkSettle?: (effect: Effect.Effect<void>) => Effect.Effect<void>;
}): ScheduleServiceShape => {
  const { repo, projects, sessions, newId, now } = deps;
  const forkSettle = deps.forkSettle ?? ((effect) => effect.pipe(Effect.forkDetach, Effect.asVoid));
  const tickGate = Semaphore.makeUnsafe(1);
  const inFlight = new Set<string>();

  const persistAdvance = (
    schedule: Schedule,
    firedAt: number,
    disableOnce: boolean,
    pauseReason?: SchedulePauseReason,
  ): Effect.Effect<Schedule> =>
    tryNextRun(schedule.spec, schedule.id, firedAt).pipe(
      Effect.map((next) => ({
        ...schedule,
        enabled: disableOnce || pauseReason !== undefined ? false : schedule.enabled,
        nextRunAt: disableOnce || pauseReason !== undefined ? null : iso(next),
        ...(pauseReason !== undefined ? { pauseReason } : undefined),
      })),
      Effect.catchTag("InvalidSchedule", () =>
        Effect.succeed({
          ...schedule,
          enabled: false,
          nextRunAt: null,
          pauseReason: "invalid_spec" as const,
        }),
      ),
    );

  const record = (
    schedule: Schedule,
    run: ScheduleRun,
    firedAt: number,
    disableOnce: boolean,
    pauseReason?: SchedulePauseReason,
  ): Effect.Effect<Schedule> => {
    const recorded = appendRun(schedule, run, new Date(firedAt).toISOString());
    return persistAdvance(
      recorded,
      firedAt,
      disableOnce,
      pauseReason ?? (reachedMaxRuns(recorded) && !disableOnce ? "max_runs" : undefined),
    );
  };

  const finishRun = (
    scheduleId: string,
    runId: string,
    outcome:
      | { readonly status: "succeeded" }
      | { readonly status: "failed"; readonly error: string },
  ): Effect.Effect<void> =>
    Effect.gen(function* () {
      const current = yield* repo
        .read(scheduleId)
        .pipe(Effect.catchTag("ScheduleNotFound", () => Effect.succeed(null)));
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
      const tripped = outcome.status === "failed" && failures >= SCHEDULE_CIRCUIT_FAILURES;
      const settled: Schedule = {
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
      yield* logSchedule({
        event: "schedule.settled",
        message: "schedule run settled",
        level: outcome.status === "failed" ? "warn" : "info",
        annotations: {
          scheduleId,
          runId,
          status: outcome.status,
          ...(existing.sessionId !== undefined ? { sessionId: existing.sessionId } : undefined),
          ...(outcome.status === "failed" ? { error: outcome.error } : undefined),
          consecutiveFailures: failures,
        },
      });
      if (tripped) {
        yield* logSchedule({
          event: "schedule.circuit_open",
          message: "schedule paused after consecutive failures",
          level: "warn",
          annotations: { scheduleId, failures },
        });
      } else if (atCap) {
        yield* logSchedule({
          event: "schedule.paused",
          message: "schedule paused",
          annotations: { scheduleId, pauseReason: "max_runs" },
        });
      }
    }).pipe(Effect.ignore);

  const settleAfterPrompt = (
    scheduleId: string,
    runId: string,
    ref: SessionRef,
    prompt: Effect.Effect<unknown, unknown>,
  ): Effect.Effect<void> =>
    Effect.gen(function* () {
      const prompted = yield* prompt.pipe(Effect.result);
      if (Result.isFailure(prompted)) {
        yield* finishRun(scheduleId, runId, {
          status: "failed",
          error: String(prompted.failure),
        });
        return;
      }
      const status = yield* sessions.waitUntilSettled(ref);
      if (status.phase === "idle") {
        yield* finishRun(scheduleId, runId, { status: "succeeded" });
        return;
      }
      if (status.phase === "crashed") {
        yield* finishRun(scheduleId, runId, { status: "failed", error: "session crashed" });
        return;
      }
      yield* finishRun(scheduleId, runId, {
        status: "failed",
        error: "session did not settle",
      });
    }).pipe(Effect.ensuring(Effect.sync(() => inFlight.delete(scheduleId))));

  const fireSession = (
    snapshot: ScheduleRunSnapshot,
  ): Effect.Effect<
    SessionRef,
    ProjectNotFound | StoreReadError | StoreWriteError | GitWorktreeFailure
  > =>
    Effect.gen(function* () {
      const project = yield* projects.findById(snapshot.projectId);
      const reuseSessionId = reuseSessionIdOf(scheduleSessionOf(snapshot));
      if (reuseSessionId !== undefined) {
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
    schedule: Schedule,
    reason: ScheduleRunReason,
  ): Effect.Effect<FireResult, StoreReadError | StoreWriteError> =>
    Effect.gen(function* () {
      const startedAt = now();
      const runId = yield* newId;
      const startedIso = new Date(startedAt).toISOString();
      const snapshot = snapshotOf(schedule);
      const disableOnce = snapshot.spec.kind === "once";

      if (reachedMaxRuns(schedule)) {
        const skipped = yield* record(
          schedule,
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
        yield* logSchedule({
          event: "schedule.skipped",
          message: "schedule run skipped",
          annotations: {
            scheduleId: schedule.id,
            reason,
            skipReason: "max_runs",
          },
        });
        if (schedule.pauseReason !== "max_runs") {
          yield* logSchedule({
            event: "schedule.paused",
            message: "schedule paused",
            annotations: {
              scheduleId: schedule.id,
              pauseReason: "max_runs",
            },
          });
        }
        return { schedule: skipped };
      }

      if (inFlight.has(schedule.id) || schedule.lastRunStatus === "running") {
        const skipped = yield* record(
          schedule,
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
        yield* logSchedule({
          event: "schedule.missed",
          message: "schedule run missed",
          level: "warn",
          annotations: {
            scheduleId: schedule.id,
            reason,
            skipReason: "queue_overflow",
          },
        });
        return { schedule: skipped };
      }

      // Bound target only — isolated lastSessionId being live must not block a
      // new session. Run now uses the same check; there is no queue.
      const targetId = reuseSessionIdOf(scheduleSessionOf(schedule));
      if (targetId !== undefined) {
        const live = yield* sessions.getStatus({
          projectId: schedule.projectId,
          sessionId: targetId,
        });
        if (isBusy(live.phase)) {
          const skipped = yield* record(
            schedule,
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
          yield* logSchedule({
            event: "schedule.skipped",
            message: "schedule run skipped",
            annotations: {
              scheduleId: schedule.id,
              reason,
              skipReason: "in_progress",
            },
          });
          return { schedule: skipped };
        }
      }

      inFlight.add(schedule.id);
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
        inFlight.delete(schedule.id);
        const skipped = yield* record(
          schedule,
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
        yield* logSchedule({
          event: "schedule.skipped",
          message: "schedule run skipped",
          level: "warn",
          annotations: {
            scheduleId: schedule.id,
            reason,
            skipReason: outcome.skipReason,
          },
        });
        return { schedule: skipped };
      }

      if (outcome.kind === "failed") {
        inFlight.delete(schedule.id);
        const failed = yield* record(
          schedule,
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
        yield* logSchedule({
          event: "schedule.settled",
          message: "schedule run settled",
          level: "warn",
          annotations: {
            scheduleId: schedule.id,
            runId,
            status: "failed",
            error: outcome.error,
          },
        });
        if (failed.pauseReason === "max_runs") {
          yield* logSchedule({
            event: "schedule.paused",
            message: "schedule paused",
            annotations: {
              scheduleId: schedule.id,
              pauseReason: "max_runs",
            },
          });
        }
        return { schedule: failed };
      }

      const started = yield* record(
        {
          ...schedule,
          ...persistScheduleSession(
            bindScheduleSession(scheduleSessionOf(snapshot), outcome.ref.sessionId),
          ),
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
      yield* logSchedule({
        event: "schedule.fired",
        message: "schedule fired",
        annotations: {
          scheduleId: schedule.id,
          sessionId: outcome.ref.sessionId,
          reason,
          sessionPolicy: scheduleSessionOf(snapshot).policy,
          specKind: snapshot.spec.kind,
        },
      });
      if (started.pauseReason === "max_runs") {
        yield* logSchedule({
          event: "schedule.paused",
          message: "schedule paused",
          annotations: {
            scheduleId: schedule.id,
            pauseReason: "max_runs",
          },
        });
      }
      const prompt = sessions.prompt({
        ref: outcome.ref,
        parts: [{ type: "text", text: snapshot.prompt }],
      });
      yield* forkSettle(settleAfterPrompt(schedule.id, runId, outcome.ref, prompt));
      return { schedule: started, ref: outcome.ref };
    });

  const expire = (schedule: Schedule, tickedAt: number): Effect.Effect<void, StoreWriteError> =>
    Effect.gen(function* () {
      const runId = yield* newId;
      const skipped = yield* record(
        schedule,
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
      yield* logSchedule({
        event: "schedule.expired",
        message: "schedule expired",
        annotations: { scheduleId: schedule.id },
      });
    });

  const trySession = (
    projectId: string,
    session: ScheduleSession | undefined,
  ): Effect.Effect<void, StoreReadError | InvalidSchedule> => {
    const sessionId = session === undefined ? undefined : reuseSessionIdOf(session);
    if (sessionId === undefined) {
      return Effect.void;
    }
    return sessions.find({ projectId, sessionId }).pipe(
      Effect.flatMap((found) => {
        if (found === null) {
          return Effect.fail(new InvalidSchedule({ reason: "session not found" }));
        }
        if (found.archived) {
          return Effect.fail(new InvalidSchedule({ reason: "session is archived" }));
        }
        return Effect.void;
      }),
    );
  };

  return {
    list: () =>
      repo.list().pipe(Effect.map((schedules) => Array.from(schedules).sort(compareSchedules))),

    get: (id) => repo.read(id),

    create: (input) =>
      Effect.gen(function* () {
        yield* projects.findById(input.projectId);
        yield* trySession(input.projectId, input.session);
        const createdAt = now();
        yield* tryValidate(input.spec, createdAt, input.expiresAt);
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
          ...persistScheduleSession(input.session),
          ...(input.expiresAt !== undefined ? { expiresAt: input.expiresAt } : undefined),
          ...(input.maxRuns !== undefined ? { maxRuns: input.maxRuns } : undefined),
          ...(worktree !== undefined ? { worktree } : undefined),
          ...(input.provider !== undefined ? { provider: input.provider } : undefined),
          ...(input.modelId !== undefined ? { modelId: input.modelId } : undefined),
        };
        yield* repo.write(schedule);
        yield* logSchedule({
          event: "schedule.created",
          message: "schedule created",
          annotations: {
            scheduleId: id,
            specKind: input.spec.kind,
            sessionPolicy: scheduleSessionOf(schedule).policy,
            ...(input.runNow === true ? { runNow: true } : undefined),
          },
        });
        if (input.runNow === true) {
          const fired = yield* fire(schedule, "manual");
          return fired.schedule;
        }
        return schedule;
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
        const updated: Schedule = {
          ...currentRest,
          name: input.name ?? current.name,
          prompt: input.prompt ?? current.prompt,
          spec,
          enabled,
          updatedAt: new Date(updatedAt).toISOString(),
          nextRunAt: enabled ? iso(next) : current.nextRunAt,
          ...persistScheduleSession(session),
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
        yield* logSchedule({
          event: atCapPause
            ? "schedule.paused"
            : input.enabled === true
              ? "schedule.enabled"
              : input.enabled === false
                ? "schedule.paused"
                : "schedule.updated",
          message: atCapPause
            ? "schedule paused"
            : input.enabled === true
              ? "schedule enabled"
              : input.enabled === false
                ? "schedule paused"
                : "schedule updated",
          annotations: {
            scheduleId: input.id,
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
          logSchedule({
            event: "schedule.deleted",
            message: "schedule deleted",
            annotations: { scheduleId: id },
          }),
        ),
      ),

    runNow: (id) => repo.read(id).pipe(Effect.flatMap((schedule) => fire(schedule, "manual"))),

    recover: () =>
      Effect.gen(function* () {
        const tickedAt = now();
        const finishedAt = new Date(tickedAt).toISOString();
        const schedules = yield* repo.list();
        let recovered = 0;
        yield* Effect.forEach(
          schedules,
          (schedule) => {
            const dirty = schedule.runs.some((run) => run.status === "running");
            if (!dirty) return Effect.void;
            recovered += 1;
            const next: Schedule = {
              ...schedule,
              updatedAt: finishedAt,
              lastRunStatus: "interrupted",
              lastError: "app-exit",
              runs: schedule.runs.map((run) =>
                run.status === "running"
                  ? { ...run, status: "interrupted" as const, finishedAt, error: "app-exit" }
                  : run,
              ),
            };
            inFlight.delete(schedule.id);
            return repo.write(next);
          },
          { concurrency: 1, discard: true },
        );
        if (recovered > 0) {
          yield* logSchedule({
            event: "schedule.recovered",
            message: "schedule leftover runs marked interrupted",
            annotations: { recovered },
          });
        }
      }),

    nextWakeDelay: () =>
      repo.list().pipe(
        Effect.map((schedules) => {
          const tickedAt = now();
          const times: Array<number | null> = [];
          for (const schedule of schedules) {
            if (!schedule.enabled) continue;
            times.push(schedule.nextRunAt === null ? null : Date.parse(schedule.nextRunAt));
            if (schedule.expiresAt !== undefined) times.push(Date.parse(schedule.expiresAt));
          }
          return nextWakeDelayMs(times, tickedAt);
        }),
      ),

    tick: () =>
      tickGate.withPermit(
        Effect.gen(function* () {
          const tickedAt = now();
          const schedules = yield* repo.list();
          const due = schedules
            .filter((schedule) => {
              if (!schedule.enabled) return false;
              if (schedule.expiresAt !== undefined && Date.parse(schedule.expiresAt) <= tickedAt) {
                return true;
              }
              return schedule.nextRunAt !== null && Date.parse(schedule.nextRunAt) <= tickedAt;
            })
            .sort(compareDue);

          yield* Effect.forEach(
            due,
            (schedule) =>
              Effect.gen(function* () {
                if (
                  schedule.expiresAt !== undefined &&
                  Date.parse(schedule.expiresAt) <= tickedAt
                ) {
                  yield* expire(schedule, tickedAt);
                  return;
                }
                const nextRunMs = Date.parse(schedule.nextRunAt!);
                if (isStale(nextRunMs, tickedAt)) {
                  const runId = yield* newId;
                  const missedCount = countMissedSlots(schedule.spec, nextRunMs, tickedAt);
                  const missed = yield* record(
                    schedule,
                    {
                      id: runId,
                      startedAt: new Date(tickedAt).toISOString(),
                      reason: "scheduled",
                      status: "missed",
                      skipReason: "stale",
                      missedCount,
                    },
                    tickedAt,
                    schedule.spec.kind === "once",
                  );
                  yield* repo.write(missed);
                  yield* logSchedule({
                    event: "schedule.missed",
                    message: "schedule run missed",
                    level: "warn",
                    annotations: {
                      scheduleId: schedule.id,
                      skipReason: "stale",
                      missedCount,
                    },
                  });
                  return;
                }
                if (isLate(nextRunMs, tickedAt)) {
                  const missedCount = countMissedSlots(schedule.spec, nextRunMs, tickedAt);
                  const missedId = yield* newId;
                  const withMissed = appendRun(
                    schedule,
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
                  yield* logSchedule({
                    event: "schedule.missed",
                    message: "schedule run missed",
                    level: "warn",
                    annotations: {
                      scheduleId: schedule.id,
                      missedCount,
                    },
                  });
                  yield* fire(withMissed, "missed_recovery");
                  return;
                }
                yield* fire(schedule, "scheduled");
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
      sessions: {
        create: (input) => sessions.create(input),
        prompt: (input) => sessions.prompt(input),
        getStatus: (ref) => sessions.getStatus(ref),
        find: (ref) => findSession(sessions, ref),
        waitUntilSettled: (ref) => waitUntilSettled(sessions, ref),
      },
      newId: crypto.randomUUIDv4.pipe(
        Effect.catchTag("PlatformError", (cause) =>
          Effect.die(new Error("invariant: platform RNG failed minting an schedule id", { cause })),
        ),
      ),
      now: () => Date.now(),
    });
  }),
);
