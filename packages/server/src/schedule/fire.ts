import type {
  Schedule,
  SchedulePauseReason,
  ScheduleRunReason,
  ScheduleRunSnapshot,
  ScheduleSkipReason,
  SessionRef,
} from "@getpie/contract";
import {
  bindScheduleSession,
  persistScheduleSession,
  reachedMaxRuns,
  reuseSessionIdOf,
  scheduleSessionOf,
} from "@getpie/contract";
import { Clock, Crypto, Effect } from "effect";

import type { StoreReadError, StoreWriteError } from "../errors";
import { PiAgentSessionService } from "../harness";
import { ProjectService } from "../project";
import { ScheduleRepository } from "./repository";
import { record, snapshotOf } from "./run-record";
import {
  claimInFlight,
  logSchedule,
  newScheduleId,
  releaseInFlight,
  ScheduleRuntime,
} from "./runtime";
import { fireSession, isBusy } from "./session";
import { settleAfterPrompt } from "./settle";

export type FireResult = {
  readonly schedule: Schedule;
  readonly ref?: SessionRef;
};

type FireDecision =
  | {
      readonly kind: "skip";
      readonly skipReason: ScheduleSkipReason;
      readonly pauseReason?: SchedulePauseReason;
    }
  | { readonly kind: "miss"; readonly skipReason: "queue_overflow" | "stale" }
  | { readonly kind: "fail"; readonly error: string }
  | { readonly kind: "run"; readonly ref: SessionRef };

type FireContext = {
  readonly schedule: Schedule;
  readonly reason: ScheduleRunReason;
  readonly startedAt: number;
  readonly runId: string;
  readonly snapshot: ScheduleRunSnapshot;
  readonly disableOnce: boolean;
};

const conclude = (
  ctx: FireContext,
  decision: FireDecision,
): Effect.Effect<
  FireResult,
  StoreReadError | StoreWriteError,
  ScheduleRepository | PiAgentSessionService | ScheduleRuntime
> =>
  Effect.gen(function* () {
    const repo = yield* ScheduleRepository;
    const startedIso = new Date(ctx.startedAt).toISOString();
    switch (decision.kind) {
      case "skip": {
        const skipped = yield* record(
          ctx.schedule,
          {
            id: ctx.runId,
            startedAt: startedIso,
            reason: ctx.reason,
            status: "skipped",
            skipReason: decision.skipReason,
            snapshot: ctx.snapshot,
          },
          ctx.startedAt,
          false,
          decision.pauseReason,
        );
        yield* repo.write(skipped);
        yield* logSchedule({
          event: "schedule.skipped",
          message: "schedule run skipped",
          level: decision.skipReason === "project_missing" ? "warn" : "info",
          annotations: {
            scheduleId: ctx.schedule.id,
            reason: ctx.reason,
            skipReason: decision.skipReason,
          },
        });
        if (decision.pauseReason === "max_runs" && ctx.schedule.pauseReason !== "max_runs") {
          yield* logSchedule({
            event: "schedule.paused",
            message: "schedule paused",
            annotations: {
              scheduleId: ctx.schedule.id,
              pauseReason: "max_runs",
            },
          });
        }
        return { schedule: skipped };
      }
      case "miss": {
        const missed = yield* record(
          ctx.schedule,
          {
            id: ctx.runId,
            startedAt: startedIso,
            reason: ctx.reason,
            status: "missed",
            skipReason: decision.skipReason,
            snapshot: ctx.snapshot,
          },
          ctx.startedAt,
          false,
        );
        yield* repo.write(missed);
        yield* logSchedule({
          event: "schedule.missed",
          message: "schedule run missed",
          level: "warn",
          annotations: {
            scheduleId: ctx.schedule.id,
            reason: ctx.reason,
            skipReason: decision.skipReason,
          },
        });
        return { schedule: missed };
      }
      case "fail": {
        const failed = yield* record(
          ctx.schedule,
          {
            id: ctx.runId,
            startedAt: startedIso,
            reason: ctx.reason,
            status: "failed",
            error: decision.error,
            finishedAt: startedIso,
            snapshot: ctx.snapshot,
          },
          ctx.startedAt,
          ctx.disableOnce,
        );
        yield* repo.write(failed);
        yield* logSchedule({
          event: "schedule.settled",
          message: "schedule run settled",
          level: "warn",
          annotations: {
            scheduleId: ctx.schedule.id,
            runId: ctx.runId,
            status: "failed",
            error: decision.error,
          },
        });
        if (failed.pauseReason === "max_runs") {
          yield* logSchedule({
            event: "schedule.paused",
            message: "schedule paused",
            annotations: {
              scheduleId: ctx.schedule.id,
              pauseReason: "max_runs",
            },
          });
        }
        return { schedule: failed };
      }
      case "run": {
        const started = yield* record(
          {
            ...ctx.schedule,
            ...persistScheduleSession(
              bindScheduleSession(scheduleSessionOf(ctx.snapshot), decision.ref.sessionId),
            ),
          },
          {
            id: ctx.runId,
            startedAt: startedIso,
            reason: ctx.reason,
            status: "running",
            sessionId: decision.ref.sessionId,
            snapshot: ctx.snapshot,
          },
          ctx.startedAt,
          ctx.disableOnce,
        );
        yield* repo.write(started);
        yield* logSchedule({
          event: "schedule.fired",
          message: "schedule fired",
          annotations: {
            scheduleId: ctx.schedule.id,
            sessionId: decision.ref.sessionId,
            reason: ctx.reason,
            sessionPolicy: scheduleSessionOf(ctx.snapshot).policy,
            specKind: ctx.snapshot.spec.kind,
          },
        });
        if (started.pauseReason === "max_runs") {
          yield* logSchedule({
            event: "schedule.paused",
            message: "schedule paused",
            annotations: {
              scheduleId: ctx.schedule.id,
              pauseReason: "max_runs",
            },
          });
        }
        const sessions = yield* PiAgentSessionService;
        const prompt = sessions.prompt({
          ref: decision.ref,
          parts: [{ type: "text", text: ctx.snapshot.prompt }],
        });
        const runtime = yield* ScheduleRuntime;
        yield* settleAfterPrompt(ctx.schedule.id, ctx.runId, decision.ref, prompt).pipe(
          Effect.forkIn(runtime.scope, { startImmediately: true }),
          Effect.asVoid,
        );
        return { schedule: started, ref: decision.ref };
      }
      default: {
        const exhaustive: never = decision;
        return exhaustive;
      }
    }
  });

const decide = (
  schedule: Schedule,
): Effect.Effect<FireDecision, never, PiAgentSessionService | ProjectService | ScheduleRuntime> =>
  Effect.gen(function* () {
    if (reachedMaxRuns(schedule)) {
      return { kind: "skip", skipReason: "max_runs", pauseReason: "max_runs" };
    }
    if (schedule.lastRunStatus === "running") {
      return { kind: "miss", skipReason: "queue_overflow" };
    }
    const targetId = reuseSessionIdOf(scheduleSessionOf(schedule));
    if (targetId !== undefined) {
      const sessions = yield* PiAgentSessionService;
      const live = yield* sessions.getStatus({
        projectId: schedule.projectId,
        sessionId: targetId,
      });
      if (isBusy(live.phase)) {
        return { kind: "skip", skipReason: "in_progress" };
      }
    }
    const claimed = yield* claimInFlight(schedule.id);
    if (!claimed) {
      return { kind: "miss", skipReason: "queue_overflow" };
    }
    return yield* fireSession(snapshotOf(schedule)).pipe(
      Effect.map((ref): FireDecision => ({ kind: "run", ref })),
      Effect.catchTag("ProjectNotFound", () =>
        releaseInFlight(schedule.id).pipe(
          Effect.as({
            kind: "skip",
            skipReason: "project_missing",
            pauseReason: "project_missing",
          } satisfies FireDecision),
        ),
      ),
      Effect.catch((error) =>
        releaseInFlight(schedule.id).pipe(
          Effect.as({
            kind: "fail",
            error: error instanceof Error ? error.message : String(error),
          } satisfies FireDecision),
        ),
      ),
    );
  });

export const fire = (
  schedule: Schedule,
  reason: ScheduleRunReason,
): Effect.Effect<
  FireResult,
  StoreReadError | StoreWriteError,
  ScheduleRepository | PiAgentSessionService | ProjectService | ScheduleRuntime | Crypto.Crypto
> =>
  Effect.gen(function* () {
    const startedAt = yield* Clock.currentTimeMillis;
    const runId = yield* newScheduleId;
    const snapshot = snapshotOf(schedule);
    const ctx: FireContext = {
      schedule,
      reason,
      startedAt,
      runId,
      snapshot,
      disableOnce: snapshot.spec.kind === "once",
    };
    const decision = yield* decide(schedule);
    return yield* conclude(ctx, decision);
  });
