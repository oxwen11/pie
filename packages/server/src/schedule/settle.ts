import type { SessionPhase, SessionRef, Schedule as StoredSchedule } from "@getpie/contract";
import {
  isCapabilityUnavailableError,
  reachedMaxRuns,
  SCHEDULE_CIRCUIT_FAILURES,
} from "@getpie/contract";
import { Clock, Effect, Result, Schedule } from "effect";

import { PiAgentSessionService } from "../harness";
import { ScheduleRepository } from "./repository";
import { patchRun } from "./run-record";
import { logSchedule, releaseInFlight, ScheduleRuntime } from "./runtime";

const SETTLE_ATTEMPTS = 300;

const waitUntilSettled = (
  ref: SessionRef,
): Effect.Effect<{ readonly phase: SessionPhase }, never, PiAgentSessionService> =>
  Effect.gen(function* () {
    const sessions = yield* PiAgentSessionService;
    const status = yield* sessions.getStatus(ref);
    if (status.phase === "idle" || status.phase === "crashed") return status;
    return yield* Effect.fail("pending" as const);
  }).pipe(
    Effect.retry({
      times: SETTLE_ATTEMPTS - 1,
      schedule: Schedule.spaced("200 millis"),
    }),
    Effect.catch(() =>
      Effect.gen(function* () {
        const sessions = yield* PiAgentSessionService;
        return yield* sessions.getStatus(ref);
      }),
    ),
  );

const finishRun = (
  scheduleId: string,
  runId: string,
  outcome: { readonly status: "succeeded" } | { readonly status: "failed"; readonly error: string },
): Effect.Effect<void, never, ScheduleRepository> =>
  Effect.gen(function* () {
    const repo = yield* ScheduleRepository;
    const current = yield* repo
      .read(scheduleId)
      .pipe(Effect.catchTag("ScheduleNotFound", () => Effect.succeed(null)));
    if (current === null) return;
    const existing = current.runs.find((run) => run.id === runId);
    if (existing?.status !== "running") return;
    const finishedAt = new Date(yield* Clock.currentTimeMillis).toISOString();
    const capabilityBlocked =
      outcome.status === "failed" && isCapabilityUnavailableError(outcome.error);
    const failures =
      outcome.status === "failed" && !capabilityBlocked
        ? (current.consecutiveFailures ?? 0) + 1
        : 0;
    const tripped = outcome.status === "failed" && failures >= SCHEDULE_CIRCUIT_FAILURES;
    const settled: StoredSchedule = {
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

export const settleAfterPrompt = (
  scheduleId: string,
  runId: string,
  ref: SessionRef,
  prompt: Effect.Effect<unknown, unknown>,
): Effect.Effect<void, never, ScheduleRepository | PiAgentSessionService | ScheduleRuntime> =>
  Effect.gen(function* () {
    const prompted = yield* prompt.pipe(Effect.result);
    if (Result.isFailure(prompted)) {
      yield* finishRun(scheduleId, runId, {
        status: "failed",
        error: String(prompted.failure),
      });
      return;
    }
    const status = yield* waitUntilSettled(ref);
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
  }).pipe(Effect.ensuring(releaseInFlight(scheduleId)));
