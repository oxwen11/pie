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

export type WallClock = {
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly weekday: number;
};

const WEEKDAY_INDEX = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
} as const;

export function assertTimeZone(timeZone: string): void {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format();
  } catch {
    throw new CronError("INVALID_TIMEZONE", `unknown time zone: ${timeZone}`);
  }
}

export function partsInTimeZone(ms: number, timeZone: string): WallClock {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(ms));
  const value = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? "";
  const weekdayName = value("weekday");
  const weekday =
    weekdayName in WEEKDAY_INDEX
      ? WEEKDAY_INDEX[weekdayName as keyof typeof WEEKDAY_INDEX]
      : undefined;
  if (weekday === undefined) {
    throw new CronError("INVALID_TIMEZONE", `could not read weekday in ${timeZone}`);
  }
  return {
    month: Number(value("month")),
    day: Number(value("day")),
    hour: Number(value("hour")),
    minute: Number(value("minute")),
    weekday,
  };
}

function wallClock(ms: number, timeZone?: string): WallClock {
  if (timeZone !== undefined) return partsInTimeZone(ms, timeZone);
  const d = new Date(ms);
  return {
    month: d.getMonth() + 1,
    day: d.getDate(),
    hour: d.getHours(),
    minute: d.getMinutes(),
    weekday: d.getDay(),
  };
}

function matchesWall(expr: CronExpr, wall: WallClock): boolean {
  const domMatch = expr.dom.values.has(wall.day);
  const dowMatch = expr.dow.values.has(wall.weekday);
  if (!expr.dom.any && !expr.dow.any) return domMatch || dowMatch;
  if (!expr.dom.any) return domMatch;
  if (!expr.dow.any) return dowMatch;
  return true;
}

export function nextOccurrence(cron: string, afterMs: number, timeZone?: string): number {
  if (timeZone !== undefined) assertTimeZone(timeZone);
  const expr = parseCron(cron);
  let t = nextMinuteBoundary(afterMs);
  const end = t + 5 * 366 * 24 * 60 * 60 * 1000;
  while (t <= end) {
    const wall = wallClock(t, timeZone);
    if (!expr.month.values.has(wall.month)) {
      t = timeZone === undefined ? startOfNextMonth(new Date(t)) : nextWallDay(t, wall);
      continue;
    }
    if (!matchesWall(expr, wall)) {
      t = timeZone === undefined ? startOfNextDay(new Date(t)) : nextWallDay(t, wall);
      continue;
    }
    if (!expr.hour.values.has(wall.hour)) {
      t = timeZone === undefined ? startOfNextHour(new Date(t)) : nextWallHour(t, wall);
      continue;
    }
    if (!expr.minute.values.has(wall.minute)) {
      t += 60_000;
      continue;
    }
    return t;
  }
  throw new CronError("INVALID_CRON", `no next occurrence for ${cron}`);
}

export function previousOccurrence(
  cron: string,
  beforeMs: number,
  timeZone?: string,
): number | null {
  if (timeZone !== undefined) assertTimeZone(timeZone);
  const expr = parseCron(cron);
  let t = previousMinuteBoundary(beforeMs);
  const start = t - 5 * 366 * 24 * 60 * 60 * 1000;
  while (t >= start) {
    const wall = wallClock(t, timeZone);
    if (!expr.month.values.has(wall.month)) {
      t = timeZone === undefined ? endOfPreviousMonth(new Date(t)) : previousWallDay(t, wall);
      continue;
    }
    if (!matchesWall(expr, wall)) {
      t = timeZone === undefined ? endOfPreviousDay(new Date(t)) : previousWallDay(t, wall);
      continue;
    }
    if (!expr.hour.values.has(wall.hour)) {
      t = timeZone === undefined ? endOfPreviousHour(new Date(t)) : previousWallHour(t, wall);
      continue;
    }
    if (!expr.minute.values.has(wall.minute)) {
      t -= 60_000;
      continue;
    }
    return t;
  }
  return null;
}

function nextWallHour(t: number, wall: WallClock): number {
  return t + (60 - wall.minute) * 60_000;
}

function nextWallDay(t: number, wall: WallClock): number {
  return t + ((24 - wall.hour) * 60 - wall.minute) * 60_000;
}

function previousWallHour(t: number, wall: WallClock): number {
  return t - (wall.minute + 1) * 60_000;
}

function previousWallDay(t: number, wall: WallClock): number {
  return t - (wall.hour * 60 + wall.minute + 1) * 60_000;
}

function nextMinuteBoundary(afterMs: number): number {
  return Math.floor(afterMs / 60_000) * 60_000 + 60_000;
}

function previousMinuteBoundary(beforeMs: number): number {
  return Math.floor((beforeMs - 1) / 60_000) * 60_000;
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

export function applyRecurringJitter(
  cron: string,
  taskId: string,
  afterMs: number,
  timeZone?: string,
): number {
  const nominal = nextOccurrence(cron, afterMs, timeZone);
  const previous = previousOccurrence(cron, nominal, timeZone);
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
