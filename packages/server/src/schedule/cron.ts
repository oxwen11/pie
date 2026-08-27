/**
 * 5-field cron in the process local timezone. Same dialect as `@getpie/pi-loop`
 * so in-session loops and application Schedules share one calendar language.
 */

export class CronError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(`${code}: ${message}`);
    this.name = "CronError";
    this.code = code;
  }
}

export interface CronExpr {
  minute: Field;
  hour: Field;
  dom: Field;
  month: Field;
  dow: Field;
}

export interface Field {
  any: boolean;
  values: Set<number>;
}

const THIRTY_MIN_MS = 30 * 60 * 1000;

export function parseCron(cron: string): CronExpr {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new CronError(
      "INVALID_CRON",
      "expected 5-field cron: minute hour day-of-month month day-of-week",
    );
  }
  if (/[a-zA-Z?#LW]/.test(cron)) {
    throw new CronError("INVALID_CRON", "names and extensions (L, W, ?, #) are not supported");
  }
  return {
    minute: parseField(parts[0]!, 0, 59),
    hour: parseField(parts[1]!, 0, 23),
    dom: parseField(parts[2]!, 1, 31),
    month: parseField(parts[3]!, 1, 12),
    dow: parseField(parts[4]!, 0, 6),
  };
}

function parseField(raw: string, min: number, max: number): Field {
  if (raw === "*") {
    return { any: true, values: fill(min, max, 1) };
  }
  const values = new Set<number>();
  for (const item of raw.split(",")) {
    const stepMatch = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/.exec(item);
    if (!stepMatch) {
      throw new CronError("INVALID_CRON", `invalid field: ${item}`);
    }
    const range = stepMatch[1]!;
    const step = stepMatch[2] ? Number(stepMatch[2]) : 1;
    if (!Number.isInteger(step) || step <= 0) {
      throw new CronError("INVALID_CRON", `invalid step: ${item}`);
    }
    let start = min;
    let end = max;
    if (range !== "*") {
      const bounds = range.split("-").map(Number);
      start = bounds[0]!;
      end = bounds.length === 2 ? bounds[1]! : start;
    }
    if (start < min || end > max || start > end) {
      throw new CronError("INVALID_CRON", `field out of range: ${item}`);
    }
    for (let n = start; n <= end; n += step) values.add(n);
  }
  return { any: false, values };
}

function fill(min: number, max: number, step: number): Set<number> {
  const values = new Set<number>();
  for (let n = min; n <= max; n += step) values.add(n);
  return values;
}

function matchesDomDow(expr: CronExpr, date: Date): boolean {
  const domMatch = expr.dom.values.has(date.getDate());
  const dowMatch = expr.dow.values.has(date.getDay());
  if (!expr.dom.any && !expr.dow.any) return domMatch || dowMatch;
  if (!expr.dom.any) return domMatch;
  if (!expr.dow.any) return dowMatch;
  return true;
}

export function nextOccurrence(cron: string, afterMs: number): number {
  const expr = parseCron(cron);
  let t = nextMinuteBoundary(afterMs);
  const end = t + 5 * 366 * 24 * 60 * 60 * 1000;
  while (t <= end) {
    const d = new Date(t);
    if (!expr.month.values.has(d.getMonth() + 1)) {
      t = startOfNextMonth(d);
      continue;
    }
    if (!matchesDomDow(expr, d)) {
      t = startOfNextDay(d);
      continue;
    }
    if (!expr.hour.values.has(d.getHours())) {
      t = startOfNextHour(d);
      continue;
    }
    if (!expr.minute.values.has(d.getMinutes())) {
      t += 60_000;
      continue;
    }
    return t;
  }
  throw new CronError("INVALID_CRON", `no next occurrence for ${cron}`);
}

export function previousOccurrence(cron: string, beforeMs: number): number | null {
  const expr = parseCron(cron);
  let t = previousMinuteBoundary(beforeMs);
  const start = t - 5 * 366 * 24 * 60 * 60 * 1000;
  while (t >= start) {
    const d = new Date(t);
    if (!expr.month.values.has(d.getMonth() + 1)) {
      t = endOfPreviousMonth(d);
      continue;
    }
    if (!matchesDomDow(expr, d)) {
      t = endOfPreviousDay(d);
      continue;
    }
    if (!expr.hour.values.has(d.getHours())) {
      t = endOfPreviousHour(d);
      continue;
    }
    if (!expr.minute.values.has(d.getMinutes())) {
      t -= 60_000;
      continue;
    }
    return t;
  }
  return null;
}

function nextMinuteBoundary(afterMs: number): number {
  const d = new Date(afterMs + 1);
  d.setSeconds(0, 0);
  if (d.getTime() <= afterMs) d.setMinutes(d.getMinutes() + 1);
  return d.getTime();
}

function previousMinuteBoundary(beforeMs: number): number {
  const d = new Date(beforeMs - 1);
  d.setSeconds(0, 0);
  if (d.getTime() >= beforeMs) d.setMinutes(d.getMinutes() - 1);
  return d.getTime();
}

function startOfNextHour(d: Date): number {
  const n = new Date(d);
  n.setSeconds(0, 0);
  n.setMinutes(0);
  n.setHours(n.getHours() + 1);
  return n.getTime();
}

function startOfNextDay(d: Date): number {
  const n = new Date(d);
  n.setSeconds(0, 0);
  n.setMinutes(0);
  n.setHours(0);
  n.setDate(n.getDate() + 1);
  return n.getTime();
}

function startOfNextMonth(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth() + 1, 1, 0, 0, 0, 0).getTime();
}

function endOfPreviousHour(d: Date): number {
  const n = new Date(d);
  n.setSeconds(0, 0);
  n.setMinutes(59);
  n.setHours(n.getHours() - 1);
  return n.getTime();
}

function endOfPreviousDay(d: Date): number {
  const n = new Date(d);
  n.setSeconds(0, 0);
  n.setMinutes(59);
  n.setHours(23);
  n.setDate(n.getDate() - 1);
  return n.getTime();
}

function endOfPreviousMonth(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), 0, 23, 59, 0, 0).getTime();
}

export function stableHash(text: string): number {
  let hash = 2166136261;
  for (const byte of new TextEncoder().encode(text)) {
    hash ^= byte;
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash;
}

export function applyRecurringJitter(cron: string, taskId: string, afterMs: number): number {
  const nominal = nextOccurrence(cron, afterMs);
  const previous = previousOccurrence(cron, nominal);
  const gapMs = previous == null ? 60_000 : nominal - previous;
  const maxJitterMs = Math.min(THIRTY_MIN_MS, Math.floor(gapMs / 2));
  const offsetMs = maxJitterMs <= 0 ? 0 : stableHash(taskId) % maxJitterMs;
  return nominal + offsetMs;
}

export function applyOneShotJitter(runAt: number, taskId: string, createdAt: number): number {
  const minutes = new Date(runAt).getMinutes();
  if (minutes !== 0 && minutes !== 30) return runAt;
  const offsetMs = stableHash(taskId) % 90_000;
  const candidate = runAt - offsetMs;
  return candidate <= createdAt ? runAt : candidate;
}

export function parseRunAt(value: string): number {
  if (!/(Z|[+-]\d{2}:\d{2})$/.test(value)) {
    throw new CronError("INVALID_RUN_AT", "run_at must include a timezone");
  }
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) {
    throw new CronError("INVALID_RUN_AT", `invalid timestamp: ${value}`);
  }
  return ms;
}
