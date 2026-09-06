import type {
  SchedulePauseReason,
  ScheduleRunReason,
  ScheduleRunStatus,
  ScheduleSkipReason,
  ScheduleSpec,
} from "@getpie/contract";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

function splitEveryMs(everyMs: number) {
  if (everyMs % DAY_MS === 0) return { amount: String(everyMs / DAY_MS), unit: "days" };
  if (everyMs % HOUR_MS === 0) return { amount: String(everyMs / HOUR_MS), unit: "hours" };
  return { amount: String(Math.max(1, Math.round(everyMs / MINUTE_MS))), unit: "minutes" };
}

const pad = (n: number): string => String(n).padStart(2, "0");

/** One-way pretty-print of known cron presets. Does not reverse-parse into the form. */
function formatCronExpr(expr: string, timeZone?: string): string {
  if (timeZone !== undefined) return `${expr} (${timeZone})`;
  if (expr === "0 * * * *") return "Hourly";
  const daily = /^(\d{1,2}) (\d{1,2}) \* \* \*$/.exec(expr);
  if (daily) return `Daily at ${pad(Number(daily[2]))}:${pad(Number(daily[1]))}`;
  const weekdays = /^(\d{1,2}) (\d{1,2}) \* \* 1-5$/.exec(expr);
  if (weekdays) return `Weekdays at ${pad(Number(weekdays[2]))}:${pad(Number(weekdays[1]))}`;
  const weekly = /^(\d{1,2}) (\d{1,2}) \* \* ([0-6])$/.exec(expr);
  if (weekly) return `Weekly at ${pad(Number(weekly[2]))}:${pad(Number(weekly[1]))}`;
  return expr;
}

export function formatSpec(spec: ScheduleSpec): string {
  if (spec.kind === "manual") return "Manual";
  if (spec.kind === "once") return `Once at ${new Date(spec.runAt).toLocaleString()}`;
  if (spec.kind === "every") {
    const split = splitEveryMs(spec.everyMs);
    const unit = split.amount === "1" ? split.unit.slice(0, -1) : split.unit;
    return `Every ${split.amount} ${unit}`;
  }
  return formatCronExpr(spec.expr, spec.timeZone);
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
  return `Next run ${new Date(nextRunAt).toLocaleString()}`;
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
  if (reason === "queue_overflow") return "queue overflow";
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
