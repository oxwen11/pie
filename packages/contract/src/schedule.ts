import { Schema, SchemaGetter } from "effect";

import { CreateWorktreeInputSchema, serverErrors, SessionRefSchema } from "./domain";
import { oc } from "./orpc";

const base = oc.errors(serverErrors);

export const MAX_SCHEDULE_NAME_CHARS = 80;
export const MAX_SCHEDULE_PROMPT_CHARS = 25_000;
export const MAX_SCHEDULES = 50;
export const MIN_SCHEDULE_EVERY_MS = 60_000;
export const MAX_SCHEDULE_EVERY_MS = 365 * 24 * 60 * 60 * 1000;
export const MAX_SCHEDULE_MAX_RUNS = 10_000;
export const SCHEDULE_CIRCUIT_FAILURES = 3;

export const ScheduleCronSpecSchema = Schema.Struct({
  kind: Schema.Literal("cron"),
  /** 5-field cron: minute hour day-of-month month day-of-week. */
  expr: Schema.NonEmptyString,
  /** IANA timezone. Absent means the server's local timezone. */
  timeZone: Schema.optionalKey(Schema.NonEmptyString),
});
export type ScheduleCronSpec = typeof ScheduleCronSpecSchema.Type;

export const ScheduleOnceSpecSchema = Schema.Struct({
  kind: Schema.Literal("once"),
  /** Timezone-aware ISO-8601 instant. */
  runAt: Schema.NonEmptyString,
});
export type ScheduleOnceSpec = typeof ScheduleOnceSpecSchema.Type;

export const ScheduleEverySpecSchema = Schema.Struct({
  kind: Schema.Literal("every"),
  everyMs: Schema.Number.check(
    Schema.isGreaterThanOrEqualTo(MIN_SCHEDULE_EVERY_MS),
    Schema.isLessThanOrEqualTo(MAX_SCHEDULE_EVERY_MS),
  ),
});
export type ScheduleEverySpec = typeof ScheduleEverySpecSchema.Type;

export const ScheduleManualSpecSchema = Schema.Struct({
  kind: Schema.Literal("manual"),
});
export type ScheduleManualSpec = typeof ScheduleManualSpecSchema.Type;

export const ScheduleSpecSchema = Schema.Union([
  ScheduleCronSpecSchema,
  ScheduleOnceSpecSchema,
  ScheduleEverySpecSchema,
  ScheduleManualSpecSchema,
]);
export type ScheduleSpec = typeof ScheduleSpecSchema.Type;

export const ScheduleSessionIsolatedSchema = Schema.Struct({
  policy: Schema.Literal("isolated"),
});
export const ScheduleSessionOwnedSchema = Schema.Struct({
  policy: Schema.Literal("owned"),
  sessionId: Schema.optionalKey(Schema.String),
});
export const ScheduleSessionExistingSchema = Schema.Struct({
  policy: Schema.Literal("existing"),
  sessionId: Schema.String,
});
export const ScheduleSessionSchema = Schema.Union([
  ScheduleSessionIsolatedSchema,
  ScheduleSessionOwnedSchema,
  ScheduleSessionExistingSchema,
]);
export type ScheduleSession = typeof ScheduleSessionSchema.Type;

export function scheduleSessionOf(schedule: {
  readonly session?: ScheduleSession;
}): ScheduleSession {
  return schedule.session ?? { policy: "isolated" };
}

export function reuseSessionIdOf(session: ScheduleSession): string | undefined {
  return session.policy === "isolated" ? undefined : session.sessionId;
}

export function persistScheduleSession(session: ScheduleSession | undefined): {
  readonly session?: ScheduleSession;
} {
  return session !== undefined && session.policy !== "isolated" ? { session } : {};
}

export function bindScheduleSession(
  session: ScheduleSession,
  sessionId: string,
): ScheduleSession | undefined {
  if (session.policy === "isolated") return undefined;
  if (session.policy === "owned") return { policy: "owned", sessionId };
  return { policy: "existing", sessionId };
}

export const SchedulePauseReasonSchema = Schema.Literals([
  "manual",
  "expired",
  "failureCircuit",
  "project_missing",
  "invalid_spec",
  "max_runs",
]);
export type SchedulePauseReason = typeof SchedulePauseReasonSchema.Type;

export const ScheduleRunReasonSchema = Schema.Literals([
  "scheduled",
  "catch_up",
  "manual",
  "missed_recovery",
]);
export type ScheduleRunReason = typeof ScheduleRunReasonSchema.Type;

const StoredRunStatusSchema = Schema.Literals([
  "started",
  "running",
  "succeeded",
  "failed",
  "skipped",
  "missed",
  "interrupted",
]);

export const ScheduleRunStatusSchema = StoredRunStatusSchema.pipe(
  Schema.decodeTo(
    Schema.Literals(["running", "succeeded", "failed", "skipped", "missed", "interrupted"]),
    {
      decode: SchemaGetter.transform((status) => (status === "started" ? "running" : status)),
      encode: SchemaGetter.transform((status) => status),
    },
  ),
);
export type ScheduleRunStatus = typeof ScheduleRunStatusSchema.Type;

export const ScheduleSkipReasonSchema = Schema.Literals([
  "in_progress",
  "stale",
  "project_missing",
  "queue_overflow",
  "expired",
  "max_runs",
]);
export type ScheduleSkipReason = typeof ScheduleSkipReasonSchema.Type;

export const ScheduleRunSnapshotSchema = Schema.Struct({
  name: Schema.String,
  prompt: Schema.String,
  projectId: Schema.String,
  spec: ScheduleSpecSchema,
  session: Schema.optionalKey(ScheduleSessionSchema),
  worktree: Schema.optionalKey(CreateWorktreeInputSchema),
  provider: Schema.optionalKey(Schema.NonEmptyString),
  modelId: Schema.optionalKey(Schema.NonEmptyString),
});
export type ScheduleRunSnapshot = typeof ScheduleRunSnapshotSchema.Type;

export const ScheduleRunSchema = Schema.Struct({
  id: Schema.String,
  startedAt: Schema.String,
  reason: ScheduleRunReasonSchema,
  status: ScheduleRunStatusSchema,
  finishedAt: Schema.optionalKey(Schema.String),
  sessionId: Schema.optionalKey(Schema.String),
  error: Schema.optionalKey(Schema.String),
  skipReason: Schema.optionalKey(ScheduleSkipReasonSchema),
  missedCount: Schema.optionalKey(Schema.Number),
  snapshot: Schema.optionalKey(ScheduleRunSnapshotSchema),
});
export type ScheduleRun = typeof ScheduleRunSchema.Type;

const scheduleMaxRuns = Schema.Number.check(
  Schema.isInt(),
  Schema.isGreaterThanOrEqualTo(1),
  Schema.isLessThanOrEqualTo(MAX_SCHEDULE_MAX_RUNS),
);

export const ScheduleSchema = Schema.Struct({
  id: Schema.String.check(Schema.isUUID()),
  name: Schema.String,
  projectId: Schema.String.check(Schema.isUUID()),
  prompt: Schema.String,
  spec: ScheduleSpecSchema,
  enabled: Schema.Boolean,
  session: Schema.optionalKey(ScheduleSessionSchema),
  expiresAt: Schema.optionalKey(Schema.String),
  maxRuns: Schema.optionalKey(scheduleMaxRuns),
  firedCount: Schema.optionalKey(
    Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  ),
  pauseReason: Schema.optionalKey(SchedulePauseReasonSchema),
  consecutiveFailures: Schema.optionalKey(Schema.Number),
  worktree: Schema.optionalKey(CreateWorktreeInputSchema),
  provider: Schema.optionalKey(Schema.NonEmptyString),
  modelId: Schema.optionalKey(Schema.NonEmptyString),
  createdAt: Schema.String,
  updatedAt: Schema.String,
  nextRunAt: Schema.Union([Schema.String, Schema.Null]),
  lastRunAt: Schema.optionalKey(Schema.String),
  lastRunStatus: Schema.optionalKey(ScheduleRunStatusSchema),
  lastSessionId: Schema.optionalKey(Schema.String),
  lastError: Schema.optionalKey(Schema.String),
  runs: Schema.Array(ScheduleRunSchema),
});
export type Schedule = typeof ScheduleSchema.Type;

export function countsTowardMaxRuns(status: ScheduleRunStatus): boolean {
  return (
    status === "running" ||
    status === "succeeded" ||
    status === "failed" ||
    status === "interrupted"
  );
}

export function countFiredRuns(
  runs: ReadonlyArray<{ readonly status: ScheduleRunStatus }>,
): number {
  let n = 0;
  for (const run of runs) {
    if (countsTowardMaxRuns(run.status)) n += 1;
  }
  return n;
}

export function firedRunCount(schedule: {
  readonly firedCount?: number;
  readonly runs: ReadonlyArray<{ readonly status: ScheduleRunStatus }>;
}): number {
  return schedule.firedCount ?? countFiredRuns(schedule.runs);
}

export function reachedMaxRuns(schedule: {
  readonly maxRuns?: number;
  readonly firedCount?: number;
  readonly runs: ReadonlyArray<{ readonly status: ScheduleRunStatus }>;
}): boolean {
  return schedule.maxRuns !== undefined && firedRunCount(schedule) >= schedule.maxRuns;
}

const scheduleName = Schema.String.check(
  Schema.isTrimmed(),
  Schema.isNonEmpty(),
  Schema.isMaxLength(MAX_SCHEDULE_NAME_CHARS),
);

const schedulePrompt = Schema.String.check(
  Schema.isTrimmed(),
  Schema.isNonEmpty(),
  Schema.isMaxLength(MAX_SCHEDULE_PROMPT_CHARS),
);

export const CreateScheduleInputSchema = Schema.Struct({
  name: scheduleName,
  projectId: Schema.String.check(Schema.isUUID()),
  prompt: schedulePrompt,
  spec: ScheduleSpecSchema,
  enabled: Schema.optionalKey(Schema.Boolean),
  session: Schema.optionalKey(ScheduleSessionSchema),
  expiresAt: Schema.optionalKey(Schema.String),
  maxRuns: Schema.optionalKey(scheduleMaxRuns),
  runNow: Schema.optionalKey(Schema.Boolean),
  worktree: Schema.optionalKey(CreateWorktreeInputSchema),
  provider: Schema.optionalKey(Schema.NonEmptyString),
  modelId: Schema.optionalKey(Schema.NonEmptyString),
});
export type CreateScheduleInput = typeof CreateScheduleInputSchema.Type;

export const UpdateScheduleInputSchema = Schema.Struct({
  id: Schema.String.check(Schema.isUUID()),
  name: Schema.optionalKey(scheduleName),
  prompt: Schema.optionalKey(schedulePrompt),
  spec: Schema.optionalKey(ScheduleSpecSchema),
  enabled: Schema.optionalKey(Schema.Boolean),
  session: Schema.optionalKey(ScheduleSessionSchema),
  expiresAt: Schema.optionalKey(Schema.NullOr(Schema.String)),
  maxRuns: Schema.optionalKey(Schema.NullOr(scheduleMaxRuns)),
  worktree: Schema.optionalKey(CreateWorktreeInputSchema),
  provider: Schema.optionalKey(Schema.NonEmptyString),
  modelId: Schema.optionalKey(Schema.NonEmptyString),
});
export type UpdateScheduleInput = typeof UpdateScheduleInputSchema.Type;

export const ScheduleIdInputSchema = Schema.Struct({
  id: Schema.String.check(Schema.isUUID()),
});
export type ScheduleIdInput = typeof ScheduleIdInputSchema.Type;

export const RunScheduleOutputSchema = Schema.Struct({
  schedule: ScheduleSchema,
  ref: Schema.optionalKey(SessionRefSchema),
});
export type RunScheduleOutput = typeof RunScheduleOutputSchema.Type;

export const scheduleContract = {
  list: base.output(Schema.Array(ScheduleSchema)),
  get: base.input(ScheduleIdInputSchema).output(ScheduleSchema),
  create: base.input(CreateScheduleInputSchema).output(ScheduleSchema),
  update: base.input(UpdateScheduleInputSchema).output(ScheduleSchema),
  delete: base.input(ScheduleIdInputSchema),
  runNow: base.input(ScheduleIdInputSchema).output(RunScheduleOutputSchema),
};
