import type { ScheduleSession, ScheduleSpec } from "@getpie/contract";

export type ScheduleCadence =
  | "manual"
  | "every"
  | "hourly"
  | "daily"
  | "weekdays"
  | "weekly"
  | "once"
  | "cron";

export type ScheduleEveryUnit = "minutes" | "hours" | "days";

export const CADENCE_OPTIONS: ReadonlyArray<{
  readonly value: ScheduleCadence;
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
  readonly value: ScheduleEveryUnit;
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

export function isScheduleCadence(value: string): value is ScheduleCadence {
  return CADENCE_OPTIONS.some((option) => option.value === value);
}

export function isScheduleEveryUnit(value: string): value is ScheduleEveryUnit {
  return EVERY_UNIT_OPTIONS.some((option) => option.value === value);
}

export type ScheduleSessionPick = "create" | "existing";

export const CREATE_ON_FIRST_RUN_VALUE = "create";

export type ScheduleFormValues = {
  readonly name: string;
  readonly projectId: string;
  readonly prompt: string;
  readonly cadence: ScheduleCadence;
  readonly time: string;
  readonly weekday: string;
  readonly cron: string;
  readonly timeZone: string;
  readonly everyAmount: string;
  readonly everyUnit: ScheduleEveryUnit;
  readonly runAt: string;
  readonly expiresAt: string;
  readonly maxRuns: string;
  readonly runNow: boolean;
  readonly worktree: boolean;
  readonly reuseSession: boolean;
  readonly sessionPick: ScheduleSessionPick;
  readonly sessionId: string;
  /** Absent until the user picks; the server's default model applies until then. */
  readonly model: { readonly provider: string; readonly modelId: string } | undefined;
};

const pad = (n: number): string => String(n).padStart(2, "0");
const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export function defaultScheduleForm(projectId: string): ScheduleFormValues {
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
    maxRuns: "",
    runNow: false,
    worktree: false,
    reuseSession: false,
    sessionPick: "create",
    sessionId: "",
    model: undefined,
  };
}

export function sessionFromForm(
  form: Pick<ScheduleFormValues, "reuseSession" | "sessionPick" | "sessionId">,
  listedIds?: ReadonlySet<string>,
): ScheduleSession {
  if (!form.reuseSession) return { policy: "isolated" };
  if (
    form.sessionPick === "existing" &&
    form.sessionId !== "" &&
    (listedIds === undefined || listedIds.has(form.sessionId))
  ) {
    return { policy: "existing", sessionId: form.sessionId };
  }
  return { policy: "owned" };
}

export function sessionSelectValue(
  form: Pick<ScheduleFormValues, "sessionPick" | "sessionId">,
  listedIds?: ReadonlySet<string>,
): string {
  if (
    form.sessionPick === "existing" &&
    form.sessionId !== "" &&
    (listedIds === undefined || listedIds.has(form.sessionId))
  ) {
    return form.sessionId;
  }
  return CREATE_ON_FIRST_RUN_VALUE;
}

export function formatSessionReuse(
  session: ScheduleSession | undefined,
  titleById: ReadonlyMap<string, string>,
): string | null {
  const resolved = session ?? { policy: "isolated" };
  if (resolved.policy === "isolated") return null;
  const sessionId = resolved.sessionId;
  if (sessionId !== undefined) {
    const title = titleById.get(sessionId);
    if (title !== undefined) return `Reuses ${title}`;
  }
  if (resolved.policy === "owned") return "Creates a session on first run";
  return "Reuses a session";
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

export function everyMsFromForm(amount: string, unit: ScheduleEveryUnit): number {
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
  readonly unit: ScheduleEveryUnit;
};

export function splitEveryMs(everyMs: number): SplitEveryMs {
  if (everyMs % DAY_MS === 0) return { amount: String(everyMs / DAY_MS), unit: "days" };
  if (everyMs % HOUR_MS === 0) return { amount: String(everyMs / HOUR_MS), unit: "hours" };
  return { amount: String(Math.max(1, Math.round(everyMs / MINUTE_MS))), unit: "minutes" };
}

export function specFromForm(form: ScheduleFormValues): ScheduleSpec {
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
  spec: ScheduleSpec,
  base: ScheduleFormValues,
): Pick<
  ScheduleFormValues,
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
  // Presets are write-only. A stored cron loads as cron, not hourly/daily/weekly.
  return {
    cadence: "cron",
    time: base.time,
    weekday: base.weekday,
    cron: spec.expr.trim(),
    timeZone: spec.timeZone ?? "",
    everyAmount: base.everyAmount,
    everyUnit: base.everyUnit,
    runAt: "",
  };
}

export {
  formatFiredCap,
  formatLastRun,
  formatNextRun,
  formatRunDuration,
  formatRunReason,
  formatRunStatus,
  formatRunSummary,
  formatSkipReason,
  formatSpec,
  summarizeRuns,
  type ScheduleRunSummary,
} from "./format";
