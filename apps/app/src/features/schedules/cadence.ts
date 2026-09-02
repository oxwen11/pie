import type {
  SchedulePauseReason,
  ScheduleRunReason,
  ScheduleRunStatus,
  ScheduleSession,
  ScheduleSkipReason,
  ScheduleSpec,
} from "@getpie/contract";

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

export function formatSpec(spec: ScheduleSpec): string {
  if (spec.kind === "manual") return "Manual";
  if (spec.kind === "once") return `Once at ${new Date(spec.runAt).toLocaleString()}`;
  if (spec.kind === "every") {
    const split = splitEveryMs(spec.everyMs);
    const unit = split.amount === "1" ? split.unit.slice(0, -1) : split.unit;
    return `Every ${split.amount} ${unit}`;
  }
  const matched = formFromSpec(spec, defaultScheduleForm(""));
  if (matched.cadence === "hourly") return "Hourly";
  if (matched.cadence === "daily") return `Daily at ${matched.time}`;
  if (matched.cadence === "weekdays") return `Weekdays at ${matched.time}`;
  if (matched.cadence === "weekly") return `Weekly at ${matched.time}`;
  return spec.timeZone === undefined ? spec.expr : `${spec.expr} (${spec.timeZone})`;
}

export function formatNextRun(
  nextRunAt: string | null,
  enabled: boolean,
  pauseReason?: SchedulePauseReason,
  maxRuns?: number,
): string {
  if (!enabled) {
    if (pauseReason === "failureCircuit") return "Paused after repeated failures";
    if (pauseReason === "expired") return "Expired";
    if (pauseReason === "max_runs") {
      return maxRuns === 1 ? "Stopped after 1 run" : `Stopped after ${maxRuns ?? "N"} runs`;
    }
    if (pauseReason === "project_missing") return "Paused (project missing)";
    if (pauseReason === "invalid_spec") return "Paused (invalid cadence)";
    return "Paused";
  }
  if (nextRunAt === null) return "Run now only";
  return new Date(nextRunAt).toLocaleString();
}

export function formatFiredCap(firedCount: number, maxRuns: number): string {
  return `${firedCount} / ${maxRuns} run${maxRuns === 1 ? "" : "s"}`;
}

export function formatRunStatus(status: ScheduleRunStatus): string {
  if (status === "running") return "Running";
  if (status === "succeeded") return "Succeeded";
  if (status === "failed") return "Failed";
  if (status === "skipped") return "Skipped";
  if (status === "missed") return "Missed";
  return "Interrupted";
}

export function formatSkipReason(reason: ScheduleSkipReason): string {
  if (reason === "in_progress") return "already running";
  if (reason === "stale") return "too late";
  if (reason === "project_missing") return "project missing";
  if (reason === "queue_overflow") return "already running";
  if (reason === "max_runs") return "run limit reached";
  return "expired";
}

export function formatRunReason(reason: ScheduleRunReason): string {
  if (reason === "manual") return "Run now";
  if (reason === "missed_recovery") return "Missed recovery";
  if (reason === "catch_up") return "Catch-up";
  return "Scheduled";
}

export type ScheduleRunSummary = {
  readonly running: number;
  readonly succeeded: number;
  readonly failed: number;
  readonly skipped: number;
  readonly missed: number;
  readonly interrupted: number;
};

export function summarizeRuns(
  runs: ReadonlyArray<{ readonly status: ScheduleRunStatus }>,
): ScheduleRunSummary {
  const summary = {
    running: 0,
    succeeded: 0,
    failed: 0,
    skipped: 0,
    missed: 0,
    interrupted: 0,
  };
  for (const run of runs) {
    summary[run.status] += 1;
  }
  return summary;
}

export function formatRunSummary(summary: ScheduleRunSummary): string | null {
  const parts: string[] = [];
  if (summary.running > 0) parts.push(`${summary.running} running`);
  if (summary.succeeded > 0) parts.push(`${summary.succeeded} succeeded`);
  if (summary.failed > 0) parts.push(`${summary.failed} failed`);
  if (summary.skipped > 0) parts.push(`${summary.skipped} skipped`);
  if (summary.missed > 0) parts.push(`${summary.missed} missed`);
  if (summary.interrupted > 0) parts.push(`${summary.interrupted} interrupted`);
  return parts.length === 0 ? null : parts.join(" · ");
}

export function formatLastRun(schedule: {
  readonly lastRunStatus?: ScheduleRunStatus;
  readonly lastRunAt?: string;
  readonly lastError?: string;
  readonly runs: ReadonlyArray<{
    readonly missedCount?: number;
    readonly skipReason?: ScheduleSkipReason;
  }>;
}): string | null {
  if (schedule.lastRunStatus === undefined || schedule.lastRunAt === undefined) return null;
  const when = new Date(schedule.lastRunAt).toLocaleString();
  if (schedule.lastRunStatus === "running") return `Running since ${when}`;
  if (schedule.lastRunStatus === "succeeded") return `Last run ${when}`;
  if (schedule.lastRunStatus === "interrupted") return `Interrupted ${when}`;
  if (schedule.lastRunStatus === "missed") {
    const missed = schedule.runs[0]?.missedCount;
    return missed !== undefined && missed > 0
      ? `Missed ${missed} run${missed === 1 ? "" : "s"} ${when}`
      : `Missed ${when}`;
  }
  if (schedule.lastRunStatus === "skipped") {
    const reason = schedule.runs[0]?.skipReason;
    return reason === undefined
      ? `Skipped ${when}`
      : `Skipped (${formatSkipReason(reason)}) ${when}`;
  }
  return schedule.lastError === undefined
    ? `Failed ${when}`
    : `Failed ${when}: ${schedule.lastError}`;
}

export function formatRunDuration(
  startedAt: string,
  finishedAt: string | undefined,
  nowMs: number,
): string | null {
  const start = Date.parse(startedAt);
  if (Number.isNaN(start)) return null;
  const end = finishedAt === undefined ? nowMs : Date.parse(finishedAt);
  if (Number.isNaN(end) || end < start) return null;
  const ms = end - start;
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder === 0 ? `${minutes}m` : `${minutes}m ${remainder}s`;
}
