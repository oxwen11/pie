import {
  MAX_AUTOMATION_EVERY_MS,
  MIN_AUTOMATION_EVERY_MS,
  type AutomationSpec,
} from "@getpie/contract";

import {
  applyOneShotJitter,
  applyRecurringJitter,
  assertTimeZone,
  nextOccurrence,
  parseCron,
  parseRunAt,
} from "./cron";

export const CATCH_UP_MS = 7 * 24 * 60 * 60 * 1000;
export const LATE_MS = 60_000;
export const MIN_WAKE_MS = 1_000;
export const MAX_WAKE_MS = 60_000;
export const MAX_DUE_WALK = 1_000;

export function validateSpec(spec: AutomationSpec, now: number): void {
  if (spec.kind === "cron") {
    parseCron(spec.expr);
    if (spec.timeZone !== undefined) assertTimeZone(spec.timeZone);
    return;
  }
  if (spec.kind === "once") {
    const runAt = parseRunAt(spec.runAt);
    if (runAt <= now) {
      throw new Error("run_at is in the past");
    }
    return;
  }
  if (
    spec.kind === "every" &&
    (spec.everyMs < MIN_AUTOMATION_EVERY_MS || spec.everyMs > MAX_AUTOMATION_EVERY_MS)
  ) {
    throw new Error(
      `everyMs must be between ${MIN_AUTOMATION_EVERY_MS} and ${MAX_AUTOMATION_EVERY_MS}`,
    );
  }
}

export function validateExpiresAt(expiresAt: string | undefined, now: number): void {
  if (expiresAt === undefined) return;
  const ms = parseRunAt(expiresAt);
  if (ms <= now) {
    throw new Error("expires_at is in the past");
  }
}

export function computeNextRunAt(spec: AutomationSpec, id: string, now: number): number | null {
  if (spec.kind === "manual") return null;
  if (spec.kind === "once") {
    const runAt = parseRunAt(spec.runAt);
    if (runAt <= now) return null;
    return applyOneShotJitter(runAt, id, now);
  }
  if (spec.kind === "every") return now + spec.everyMs;
  return applyRecurringJitter(spec.expr, id, now, spec.timeZone);
}

export function countDueSlots(spec: AutomationSpec, fromMs: number, now: number): number {
  if (fromMs > now) return 0;
  if (spec.kind === "manual") return 0;
  if (spec.kind === "once") return 1;
  if (spec.kind === "every") {
    return 1 + Math.floor((now - fromMs) / spec.everyMs);
  }
  let count = 1;
  let cursor = fromMs;
  for (let i = 0; i < MAX_DUE_WALK; i++) {
    const next = nextOccurrence(spec.expr, cursor, spec.timeZone);
    if (next > now) break;
    count += 1;
    cursor = next;
  }
  return count;
}

export function countMissedSlots(spec: AutomationSpec, fromMs: number, now: number): number {
  return Math.max(0, countDueSlots(spec, fromMs, now) - 1);
}

export function isStale(nextRunAt: number, now: number): boolean {
  return now - nextRunAt > CATCH_UP_MS;
}

export function isLate(nextRunAt: number, now: number): boolean {
  return now - nextRunAt > LATE_MS;
}

export function nextWakeDelayMs(
  times: ReadonlyArray<number | null | undefined>,
  now: number,
): number {
  let next = now + MAX_WAKE_MS;
  for (const time of times) {
    if (time == null || Number.isNaN(time)) continue;
    if (time < next) next = time;
  }
  const delay = next - now;
  if (delay <= MIN_WAKE_MS) return MIN_WAKE_MS;
  if (delay >= MAX_WAKE_MS) return MAX_WAKE_MS;
  return delay;
}

export function iso(ms: number | null): string | null {
  return ms == null ? null : new Date(ms).toISOString();
}
