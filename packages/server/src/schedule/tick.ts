import type { Schedule } from "@getpie/contract";
import { Clock, Effect } from "effect";

import { fire } from "./fire";
import { countMissedSlots, isLate, isStale } from "./next-run";
import { ScheduleRepository } from "./repository";
import { appendRun, compareDue, record } from "./run-record";
import { logSchedule, newScheduleId, ScheduleRuntime } from "./runtime";

type TickDecision =
  | { readonly kind: "expire" }
  | { readonly kind: "stale"; readonly missedCount: number }
  | { readonly kind: "late"; readonly missedCount: number }
  | { readonly kind: "due" };

const decideTick = (schedule: Schedule, tickedAt: number): TickDecision => {
  if (schedule.expiresAt !== undefined && Date.parse(schedule.expiresAt) <= tickedAt) {
    return { kind: "expire" };
  }
  const nextRunMs = Date.parse(schedule.nextRunAt!);
  if (isStale(nextRunMs, tickedAt)) {
    return { kind: "stale", missedCount: countMissedSlots(schedule.spec, nextRunMs, tickedAt) };
  }
  if (isLate(nextRunMs, tickedAt)) {
    return { kind: "late", missedCount: countMissedSlots(schedule.spec, nextRunMs, tickedAt) };
  }
  return { kind: "due" };
};

const expire = (schedule: Schedule, tickedAt: number) =>
  Effect.gen(function* () {
    const repo = yield* ScheduleRepository;
    const runId = yield* newScheduleId;
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

const applyTick = (schedule: Schedule, tickedAt: number, decision: TickDecision) =>
  Effect.gen(function* () {
    const repo = yield* ScheduleRepository;
    switch (decision.kind) {
      case "expire":
        yield* expire(schedule, tickedAt);
        return;
      case "stale": {
        const runId = yield* newScheduleId;
        const missed = yield* record(
          schedule,
          {
            id: runId,
            startedAt: new Date(tickedAt).toISOString(),
            reason: "scheduled",
            status: "missed",
            skipReason: "stale",
            missedCount: decision.missedCount,
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
            missedCount: decision.missedCount,
          },
        });
        return;
      }
      case "late": {
        const missedId = yield* newScheduleId;
        const withMissed = appendRun(
          schedule,
          {
            id: missedId,
            startedAt: new Date(tickedAt).toISOString(),
            reason: "scheduled",
            status: "missed",
            missedCount: decision.missedCount,
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
            missedCount: decision.missedCount,
          },
        });
        yield* fire(withMissed, "missed_recovery");
        return;
      }
      case "due":
        yield* fire(schedule, "scheduled");
        return;
      default: {
        const exhaustive: never = decision;
        return exhaustive;
      }
    }
  });

export const tick = () =>
  Effect.gen(function* () {
    const runtime = yield* ScheduleRuntime;
    const repo = yield* ScheduleRepository;
    yield* runtime.tickGate.withPermit(
      Effect.gen(function* () {
        const tickedAt = yield* Clock.currentTimeMillis;
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
          (schedule) => applyTick(schedule, tickedAt, decideTick(schedule, tickedAt)),
          { concurrency: 1, discard: true },
        );
      }),
    );
  });
