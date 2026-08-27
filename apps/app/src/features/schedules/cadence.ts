import type { ScheduleSpec } from "@getpie/contract";

export type ScheduleCadence =
  | "manual"
  | "hourly"
  | "daily"
  | "weekdays"
  | "weekly"
  | "once"
  | "cron";

export const CADENCE_OPTIONS: ReadonlyArray<{
  readonly value: ScheduleCadence;
  readonly label: string;
}> = [
  { value: "manual", label: "Manual" },
  { value: "hourly", label: "Hourly" },
  { value: "daily", label: "Daily" },
  { value: "weekdays", label: "Weekdays" },
  { value: "weekly", label: "Weekly" },
  { value: "once", label: "Once" },
  { value: "cron", label: "Custom cron" },
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

export type ScheduleFormValues = {
  readonly name: string;
  readonly projectId: string;
  readonly prompt: string;
  readonly cadence: ScheduleCadence;
  readonly time: string;
  readonly weekday: string;
  readonly cron: string;
  readonly runAt: string;
  readonly worktree: boolean;
};

const pad = (n: number): string => String(n).padStart(2, "0");

export function defaultScheduleForm(projectId: string): ScheduleFormValues {
  return {
    name: "",
    projectId,
    prompt: "",
    cadence: "daily",
    time: "09:00",
    weekday: "1",
    cron: "0 9 * * *",
    runAt: "",
    worktree: false,
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

export function specFromForm(form: ScheduleFormValues): ScheduleSpec {
  if (form.cadence === "manual") return { kind: "manual" };
  if (form.cadence === "once") return { kind: "once", runAt: localDateTimeToIso(form.runAt) };
  if (form.cadence === "cron") return { kind: "cron", expr: form.cron.trim() };
  if (form.cadence === "hourly") return { kind: "cron", expr: "0 * * * *" };
  const { hour, minute } = parseTime(form.time);
  if (form.cadence === "daily") return { kind: "cron", expr: `${minute} ${hour} * * *` };
  if (form.cadence === "weekdays") return { kind: "cron", expr: `${minute} ${hour} * * 1-5` };
  return { kind: "cron", expr: `${minute} ${hour} * * ${form.weekday}` };
}

export function formFromSpec(
  spec: ScheduleSpec,
  base: ScheduleFormValues,
): Pick<ScheduleFormValues, "cadence" | "time" | "weekday" | "cron" | "runAt"> {
  if (spec.kind === "manual") {
    return {
      cadence: "manual",
      time: base.time,
      weekday: base.weekday,
      cron: base.cron,
      runAt: "",
    };
  }
  if (spec.kind === "once") {
    return {
      cadence: "once",
      time: base.time,
      weekday: base.weekday,
      cron: base.cron,
      runAt: isoToLocalDateTime(spec.runAt),
    };
  }
  const expr = spec.expr.trim();
  if (expr === "0 * * * *") {
    return { cadence: "hourly", time: base.time, weekday: base.weekday, cron: expr, runAt: "" };
  }
  const daily = /^(\d{1,2}) (\d{1,2}) \* \* \*$/.exec(expr);
  if (daily) {
    return {
      cadence: "daily",
      time: `${pad(Number(daily[2]))}:${pad(Number(daily[1]))}`,
      weekday: base.weekday,
      cron: expr,
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
      runAt: "",
    };
  }
  return { cadence: "cron", time: base.time, weekday: base.weekday, cron: expr, runAt: "" };
}

export function formatSpec(spec: ScheduleSpec): string {
  if (spec.kind === "manual") return "Manual";
  if (spec.kind === "once") return `Once at ${new Date(spec.runAt).toLocaleString()}`;
  const matched = formFromSpec(spec, defaultScheduleForm(""));
  if (matched.cadence === "hourly") return "Hourly";
  if (matched.cadence === "daily") return `Daily at ${matched.time}`;
  if (matched.cadence === "weekdays") return `Weekdays at ${matched.time}`;
  if (matched.cadence === "weekly") return `Weekly at ${matched.time}`;
  return spec.expr;
}

export function formatNextRun(nextRunAt: string | null, enabled: boolean): string {
  if (!enabled) return "Paused";
  if (nextRunAt === null) return "Run now only";
  return new Date(nextRunAt).toLocaleString();
}
