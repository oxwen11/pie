import type {
  AutomationPauseReason,
  AutomationRunStatus,
  AutomationSkipReason,
  AutomationSpec,
} from "@getpie/contract";

export type AutomationCadence =
  | "manual"
  | "every"
  | "hourly"
  | "daily"
  | "weekdays"
  | "weekly"
  | "once"
  | "cron";

export type AutomationEveryUnit = "minutes" | "hours" | "days";

export const CADENCE_OPTIONS: ReadonlyArray<{
  readonly value: AutomationCadence;
  readonly label: string;
}> = [
  { value: "manual", label: "Manual" },
  { value: "every", label: "Interval" },
  { value: "hourly", label: "Hourly" },
  { value: "daily", label: "Daily" },
  { value: "weekdays", label: "Weekdays" },
  { value: "weekly", label: "Weekly" },
  { value: "once", label: "Once" },
  { value: "cron", label: "Custom cron" },
];

export const EVERY_UNIT_OPTIONS: ReadonlyArray<{
  readonly value: AutomationEveryUnit;
  readonly label: string;
}> = [
  { value: "minutes", label: "Minutes" },
  { value: "hours", label: "Hours" },
  { value: "days", label: "Days" },
];

export const WEEKDAY_OPTIONS: ReadonlyArray<{ readonly value: string; readonly label: string }> = [
  { value: "1", label: "Monday" },
  { value: "2", label: "Tuesday" },
  { value: "3", label: "Wednesday" },
  { value: "4", label: "Thursday" },
  { value: "5", label: "Friday" },
  { value: "6", label: "Saturday" },
  { value: "0", label: "Sunday" },
];

export function isAutomationCadence(value: string): value is AutomationCadence {
  return CADENCE_OPTIONS.some((option) => option.value === value);
}

export function isAutomationEveryUnit(value: string): value is AutomationEveryUnit {
  return EVERY_UNIT_OPTIONS.some((option) => option.value === value);
}

export type AutomationFormValues = {
  readonly name: string;
  readonly projectId: string;
  readonly prompt: string;
  readonly cadence: AutomationCadence;
  readonly time: string;
  readonly weekday: string;
  readonly cron: string;
  readonly timeZone: string;
  readonly everyAmount: string;
  readonly everyUnit: AutomationEveryUnit;
  readonly runAt: string;
  readonly expiresAt: string;
  readonly worktree: boolean;
  readonly reuseSession: boolean;
};

const pad = (n: number): string => String(n).padStart(2, "0");
const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export function defaultAutomationForm(projectId: string): AutomationFormValues {
  return {
    name: "",
    projectId,
    prompt: "",
    cadence: "daily",
    time: "09:00",
    weekday: "1",
    cron: "0 9 * * *",
    timeZone: "",
    everyAmount: "1",
    everyUnit: "hours",
    runAt: "",
    expiresAt: "",
    worktree: false,
    reuseSession: false,
  };
}

export function localDateTimeToIso(value: string): string {
  const ms = new Date(value).getTime();
  if (Number.isNaN(ms)) {
    throw new TypeError("run_at is not a valid local datetime");
  }
  return new Date(ms).toISOString();
}

export function isoToLocalDateTime(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function defaultOnceLocal(from = new Date()): string {
  const next = new Date(from);
  next.setDate(next.getDate() + 1);
  next.setHours(9, 0, 0, 0);
  return isoToLocalDateTime(next.toISOString());
}

type ClockTime = {
  readonly hour: number;
  readonly minute: number;
};

function parseTime(time: string): ClockTime {
  const match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(time);
  if (!match) throw new Error("time must be HH:MM");
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) throw new Error("time must be HH:MM");
  return { hour, minute };
}

export function everyMsFromForm(amount: string, unit: AutomationEveryUnit): number {
  const n = Number(amount);
  if (!Number.isInteger(n) || n < 1) {
    throw new Error("interval must be a positive integer");
  }
  if (unit === "minutes") return n * MINUTE_MS;
  if (unit === "hours") return n * HOUR_MS;
  return n * DAY_MS;
}

export type SplitEveryMs = {
  readonly amount: string;
  readonly unit: AutomationEveryUnit;
};

export function splitEveryMs(everyMs: number): SplitEveryMs {
  if (everyMs % DAY_MS === 0) return { amount: String(everyMs / DAY_MS), unit: "days" };
  if (everyMs % HOUR_MS === 0) return { amount: String(everyMs / HOUR_MS), unit: "hours" };
  return { amount: String(Math.max(1, Math.round(everyMs / MINUTE_MS))), unit: "minutes" };
}

export function specFromForm(form: AutomationFormValues): AutomationSpec {
  if (form.cadence === "manual") return { kind: "manual" };
  if (form.cadence === "once") return { kind: "once", runAt: localDateTimeToIso(form.runAt) };
  if (form.cadence === "every") {
    return { kind: "every", everyMs: everyMsFromForm(form.everyAmount, form.everyUnit) };
  }
  if (form.cadence === "cron") {
    return {
      kind: "cron",
      expr: form.cron.trim(),
      ...(form.timeZone.trim() !== "" ? { timeZone: form.timeZone.trim() } : undefined),
    };
  }
  if (form.cadence === "hourly") return { kind: "cron", expr: "0 * * * *" };
  const { hour, minute } = parseTime(form.time);
  if (form.cadence === "daily") return { kind: "cron", expr: `${minute} ${hour} * * *` };
  if (form.cadence === "weekdays") return { kind: "cron", expr: `${minute} ${hour} * * 1-5` };
  return { kind: "cron", expr: `${minute} ${hour} * * ${form.weekday}` };
}

export function formFromSpec(
  spec: AutomationSpec,
  base: AutomationFormValues,
): Pick<
  AutomationFormValues,
  "cadence" | "time" | "weekday" | "cron" | "timeZone" | "everyAmount" | "everyUnit" | "runAt"
> {
  if (spec.kind === "manual") {
    return {
      cadence: "manual",
      time: base.time,
      weekday: base.weekday,
      cron: base.cron,
      timeZone: "",
      everyAmount: base.everyAmount,
      everyUnit: base.everyUnit,
      runAt: "",
    };
  }
  if (spec.kind === "once") {
    return {
      cadence: "once",
      time: base.time,
      weekday: base.weekday,
      cron: base.cron,
      timeZone: "",
      everyAmount: base.everyAmount,
      everyUnit: base.everyUnit,
      runAt: isoToLocalDateTime(spec.runAt),
    };
  }
  if (spec.kind === "every") {
    const split = splitEveryMs(spec.everyMs);
    return {
      cadence: "every",
      time: base.time,
      weekday: base.weekday,
      cron: base.cron,
      timeZone: "",
      everyAmount: split.amount,
      everyUnit: split.unit,
      runAt: "",
    };
  }
  const expr = spec.expr.trim();
  if (spec.timeZone !== undefined) {
    return {
      cadence: "cron",
      time: base.time,
      weekday: base.weekday,
      cron: expr,
      timeZone: spec.timeZone,
      everyAmount: base.everyAmount,
      everyUnit: base.everyUnit,
      runAt: "",
    };
  }
  if (expr === "0 * * * *") {
    return {
      cadence: "hourly",
      time: base.time,
      weekday: base.weekday,
      cron: expr,
      timeZone: "",
      everyAmount: base.everyAmount,
      everyUnit: base.everyUnit,
      runAt: "",
    };
  }
  const daily = /^(\d{1,2}) (\d{1,2}) \* \* \*$/.exec(expr);
  if (daily) {
    return {
      cadence: "daily",
      time: `${pad(Number(daily[2]))}:${pad(Number(daily[1]))}`,
      weekday: base.weekday,
      cron: expr,
      timeZone: "",
      everyAmount: base.everyAmount,
      everyUnit: base.everyUnit,
      runAt: "",
    };
  }
  const weekdays = /^(\d{1,2}) (\d{1,2}) \* \* 1-5$/.exec(expr);
  if (weekdays) {
    return {
      cadence: "weekdays",
      time: `${pad(Number(weekdays[2]))}:${pad(Number(weekdays[1]))}`,
      weekday: base.weekday,
      cron: expr,
      timeZone: "",
      everyAmount: base.everyAmount,
      everyUnit: base.everyUnit,
      runAt: "",
    };
  }
  const weekly = /^(\d{1,2}) (\d{1,2}) \* \* ([0-6])$/.exec(expr);
  if (weekly) {
    return {
      cadence: "weekly",
      time: `${pad(Number(weekly[2]))}:${pad(Number(weekly[1]))}`,
      weekday: weekly[3]!,
      cron: expr,
      timeZone: "",
      everyAmount: base.everyAmount,
      everyUnit: base.everyUnit,
      runAt: "",
    };
  }
  return {
    cadence: "cron",
    time: base.time,
    weekday: base.weekday,
    cron: expr,
    timeZone: "",
    everyAmount: base.everyAmount,
    everyUnit: base.everyUnit,
    runAt: "",
  };
}

export function formatSpec(spec: AutomationSpec): string {
  if (spec.kind === "manual") return "Manual";
  if (spec.kind === "once") return `Once at ${new Date(spec.runAt).toLocaleString()}`;
  if (spec.kind === "every") {
    const split = splitEveryMs(spec.everyMs);
    const unit = split.amount === "1" ? split.unit.slice(0, -1) : split.unit;
    return `Every ${split.amount} ${unit}`;
  }
  const matched = formFromSpec(spec, defaultAutomationForm(""));
  if (matched.cadence === "hourly") return "Hourly";
  if (matched.cadence === "daily") return `Daily at ${matched.time}`;
  if (matched.cadence === "weekdays") return `Weekdays at ${matched.time}`;
  if (matched.cadence === "weekly") return `Weekly at ${matched.time}`;
  return spec.timeZone === undefined ? spec.expr : `${spec.expr} (${spec.timeZone})`;
}

export function formatNextRun(
  nextRunAt: string | null,
  enabled: boolean,
  pauseReason?: AutomationPauseReason,
): string {
  if (!enabled) {
    if (pauseReason === "failureCircuit") return "Paused after repeated failures";
    if (pauseReason === "expired") return "Expired";
    if (pauseReason === "project_missing") return "Paused (project missing)";
    if (pauseReason === "invalid_spec") return "Paused (invalid cadence)";
    return "Paused";
  }
  if (nextRunAt === null) return "Run now only";
  return new Date(nextRunAt).toLocaleString();
}

export function formatRunStatus(status: AutomationRunStatus): string {
  if (status === "running") return "Running";
  if (status === "succeeded") return "Succeeded";
  if (status === "failed") return "Failed";
  if (status === "skipped") return "Skipped";
  if (status === "missed") return "Missed";
  return "Interrupted";
}

export function formatSkipReason(reason: AutomationSkipReason): string {
  if (reason === "in_progress") return "already running";
  if (reason === "stale") return "too late";
  if (reason === "project_missing") return "project missing";
  if (reason === "queue_overflow") return "already running";
  return "expired";
}
