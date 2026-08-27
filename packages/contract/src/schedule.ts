import { oc } from "@orpc/contract";
import { Schema } from "effect";

import {
  CreateWorktreeInputSchema,
  serverErrors,
  SessionRefSchema,
  toStandardSchema,
} from "./domain";

const base = oc.errors(serverErrors);

export const MAX_SCHEDULE_NAME_CHARS = 80;
export const MAX_SCHEDULE_PROMPT_CHARS = 25_000;
export const MAX_SCHEDULES = 50;

export const ScheduleCronSpecSchema = Schema.Struct({
  kind: Schema.Literal("cron"),
  /** 5-field cron in the server's local timezone: minute hour day-of-month month day-of-week. */
  expr: Schema.NonEmptyString,
});
export type ScheduleCronSpec = typeof ScheduleCronSpecSchema.Type;

export const ScheduleOnceSpecSchema = Schema.Struct({
  kind: Schema.Literal("once"),
  /** Timezone-aware ISO-8601 instant. */
  runAt: Schema.NonEmptyString,
});
export type ScheduleOnceSpec = typeof ScheduleOnceSpecSchema.Type;

export const ScheduleManualSpecSchema = Schema.Struct({
  kind: Schema.Literal("manual"),
});
export type ScheduleManualSpec = typeof ScheduleManualSpecSchema.Type;

export const ScheduleSpecSchema = Schema.Union([
  ScheduleCronSpecSchema,
  ScheduleOnceSpecSchema,
  ScheduleManualSpecSchema,
]);
export type ScheduleSpec = typeof ScheduleSpecSchema.Type;

export const ScheduleRunReasonSchema = Schema.Literals(["scheduled", "catch_up", "manual"]);
export type ScheduleRunReason = typeof ScheduleRunReasonSchema.Type;

export const ScheduleRunStatusSchema = Schema.Literals(["started", "failed", "skipped"]);
export type ScheduleRunStatus = typeof ScheduleRunStatusSchema.Type;

export const ScheduleSkipReasonSchema = Schema.Literals([
  "in_progress",
  "stale",
  "project_missing",
]);
export type ScheduleSkipReason = typeof ScheduleSkipReasonSchema.Type;

export const ScheduleRunSchema = Schema.Struct({
  id: Schema.String,
  startedAt: Schema.String,
  reason: ScheduleRunReasonSchema,
  status: ScheduleRunStatusSchema,
  sessionId: Schema.optionalKey(Schema.String),
  error: Schema.optionalKey(Schema.String),
  skipReason: Schema.optionalKey(ScheduleSkipReasonSchema),
});
export type ScheduleRun = typeof ScheduleRunSchema.Type;

export const ScheduleSchema = Schema.Struct({
  id: Schema.String.check(Schema.isUUID()),
  name: Schema.String,
  projectId: Schema.String.check(Schema.isUUID()),
  prompt: Schema.String,
  spec: ScheduleSpecSchema,
  enabled: Schema.Boolean,
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
  list: base.output(toStandardSchema(Schema.Array(ScheduleSchema))),
  get: base.input(toStandardSchema(ScheduleIdInputSchema)).output(toStandardSchema(ScheduleSchema)),
  create: base
    .input(toStandardSchema(CreateScheduleInputSchema))
    .output(toStandardSchema(ScheduleSchema)),
  update: base
    .input(toStandardSchema(UpdateScheduleInputSchema))
    .output(toStandardSchema(ScheduleSchema)),
  delete: base.input(toStandardSchema(ScheduleIdInputSchema)),
  runNow: base
    .input(toStandardSchema(ScheduleIdInputSchema))
    .output(toStandardSchema(RunScheduleOutputSchema)),
};
