import type { ScheduleSpec } from "@getpie/contract";

import { applyOneShotJitter, applyRecurringJitter, parseCron, parseRunAt } from "./cron";

export const CATCH_UP_MS = 7 * 24 * 60 * 60 * 1000;

export function validateSpec(spec: ScheduleSpec, now: number): void {
  if (spec.kind === "cron") {
    parseCron(spec.expr);
    return;
  }
  if (spec.kind === "once") {
    const runAt = parseRunAt(spec.runAt);
    if (runAt <= now) {
      throw new Error("run_at is in the past");
    }
  }
}

export function computeNextRunAt(spec: ScheduleSpec, id: string, now: number): number | null {
  if (spec.kind === "manual") return null;
  if (spec.kind === "once") {
    const runAt = parseRunAt(spec.runAt);
    if (runAt <= now) return null;
    return applyOneShotJitter(runAt, id, now);
  }
  return applyRecurringJitter(spec.expr, id, now);
}

export function isStale(nextRunAt: number, now: number): boolean {
  return now - nextRunAt > CATCH_UP_MS;
}

export function iso(ms: number | null): string | null {
  return ms == null ? null : new Date(ms).toISOString();
}
