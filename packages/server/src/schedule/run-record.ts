import type {
  Schedule,
  SchedulePauseReason,
  ScheduleRun,
  ScheduleRunSnapshot,
} from "@getpie/contract";
import {
  countsTowardMaxRuns,
  firedRunCount,
  reachedMaxRuns,
  scheduleSessionOf,
} from "@getpie/contract";
import { Effect } from "effect";

import { InvalidSchedule } from "../errors";
import { CronError } from "./cron";
import { computeNextRunAt, iso, validateExpiresAt, validateSpec } from "./next-run";

export const MAX_RUNS = 20;
const TITLE_CHARS = 60;

export const compareSchedules = (a: Schedule, b: Schedule): number => {
  if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
  if (a.nextRunAt === null && b.nextRunAt === null) return a.name.localeCompare(b.name);
  if (a.nextRunAt === null) return 1;
  if (b.nextRunAt === null) return -1;
  const byRun = a.nextRunAt.localeCompare(b.nextRunAt);
  return byRun !== 0 ? byRun : a.name.localeCompare(b.name);
};

export const compareDue = (a: Schedule, b: Schedule): number => {
  const an = a.nextRunAt ?? "";
  const bn = b.nextRunAt ?? "";
  if (an !== bn) return an.localeCompare(bn);
  return a.id.localeCompare(b.id);
};

export const titleFromName = (name: string): string =>
  name.length > TITLE_CHARS ? name.slice(0, TITLE_CHARS) : name;

export const snapshotOf = (schedule: Schedule): ScheduleRunSnapshot => ({
  name: schedule.name,
  prompt: schedule.prompt,
  projectId: schedule.projectId,
  spec: schedule.spec,
  session: scheduleSessionOf(schedule),
  ...(schedule.worktree !== undefined ? { worktree: schedule.worktree } : undefined),
  ...(schedule.provider !== undefined ? { provider: schedule.provider } : undefined),
  ...(schedule.modelId !== undefined ? { modelId: schedule.modelId } : undefined),
});

const withoutLastError = (schedule: Schedule): Omit<Schedule, "lastError"> => {
  const { lastError: _lastError, ...rest } = schedule;
  return rest;
};

export const appendRun = (schedule: Schedule, run: ScheduleRun, nowIso: string): Schedule => {
  const nextFiredCount = countsTowardMaxRuns(run.status)
    ? firedRunCount(schedule) + 1
    : schedule.firedCount;
  return {
    ...withoutLastError(schedule),
    updatedAt: nowIso,
    lastRunAt: run.startedAt,
    lastRunStatus: run.status,
    runs: [run, ...schedule.runs].slice(0, MAX_RUNS),
    ...(nextFiredCount !== undefined ? { firedCount: nextFiredCount } : undefined),
    ...(run.sessionId !== undefined ? { lastSessionId: run.sessionId } : undefined),
    ...(run.status === "failed" && run.error !== undefined ? { lastError: run.error } : undefined),
  };
};

export const patchRun = (
  schedule: Schedule,
  runId: string,
  patch: Partial<ScheduleRun>,
  nowIso: string,
): Schedule => {
  const runs = schedule.runs.map((run) => (run.id === runId ? { ...run, ...patch } : run));
  const current = runs.find((run) => run.id === runId);
  if (current === undefined) return schedule;
  return {
    ...withoutLastError(schedule),
    updatedAt: nowIso,
    runs,
    lastRunStatus: current.status,
    ...(current.sessionId !== undefined ? { lastSessionId: current.sessionId } : undefined),
    ...(current.status === "failed" && current.error !== undefined
      ? { lastError: current.error }
      : undefined),
  };
};

export const tryValidate = (
  spec: Schedule["spec"],
  now: number,
  expiresAt?: string,
): Effect.Effect<void, InvalidSchedule> =>
  Effect.try({
    try: () => {
      validateSpec(spec, now);
      validateExpiresAt(expiresAt, now);
    },
    catch: (error) =>
      new InvalidSchedule({
        reason:
          error instanceof CronError || error instanceof Error ? error.message : String(error),
      }),
  });

export const tryNextRun = (
  spec: Schedule["spec"],
  id: string,
  now: number,
): Effect.Effect<number | null, InvalidSchedule> =>
  Effect.try({
    try: () => computeNextRunAt(spec, id, now),
    catch: (error) =>
      new InvalidSchedule({
        reason:
          error instanceof CronError || error instanceof Error ? error.message : String(error),
      }),
  });

export const persistAdvance = (
  schedule: Schedule,
  firedAt: number,
  disableOnce: boolean,
  pauseReason?: SchedulePauseReason,
): Effect.Effect<Schedule> =>
  tryNextRun(schedule.spec, schedule.id, firedAt).pipe(
    Effect.map((next) => ({
      ...schedule,
      enabled: disableOnce || pauseReason !== undefined ? false : schedule.enabled,
      nextRunAt: disableOnce || pauseReason !== undefined ? null : iso(next),
      ...(pauseReason !== undefined ? { pauseReason } : undefined),
    })),
    Effect.catchTag("InvalidSchedule", () =>
      Effect.succeed({
        ...schedule,
        enabled: false,
        nextRunAt: null,
        pauseReason: "invalid_spec" as const,
      }),
    ),
  );

export const record = (
  schedule: Schedule,
  run: ScheduleRun,
  firedAt: number,
  disableOnce: boolean,
  pauseReason?: SchedulePauseReason,
): Effect.Effect<Schedule> => {
  const recorded = appendRun(schedule, run, new Date(firedAt).toISOString());
  return persistAdvance(
    recorded,
    firedAt,
    disableOnce,
    pauseReason ?? (reachedMaxRuns(recorded) && !disableOnce ? "max_runs" : undefined),
  );
};
