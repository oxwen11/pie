import { oc } from "@orpc/contract";
import { Schema } from "effect";

import {
  CreateWorktreeInputSchema,
  serverErrors,
  SessionRefSchema,
  toStandardSchema,
} from "./domain";

const base = oc.errors(serverErrors);

export const MAX_AUTOMATION_NAME_CHARS = 80;
export const MAX_AUTOMATION_PROMPT_CHARS = 25_000;
export const MAX_AUTOMATIONS = 50;

export const AutomationCronSpecSchema = Schema.Struct({
  kind: Schema.Literal("cron"),
  /** 5-field cron in the server's local timezone: minute hour day-of-month month day-of-week. */
  expr: Schema.NonEmptyString,
});
export type AutomationCronSpec = typeof AutomationCronSpecSchema.Type;

export const AutomationOnceSpecSchema = Schema.Struct({
  kind: Schema.Literal("once"),
  /** Timezone-aware ISO-8601 instant. */
  runAt: Schema.NonEmptyString,
});
export type AutomationOnceSpec = typeof AutomationOnceSpecSchema.Type;

export const AutomationManualSpecSchema = Schema.Struct({
  kind: Schema.Literal("manual"),
});
export type AutomationManualSpec = typeof AutomationManualSpecSchema.Type;

export const AutomationSpecSchema = Schema.Union([
  AutomationCronSpecSchema,
  AutomationOnceSpecSchema,
  AutomationManualSpecSchema,
]);
export type AutomationSpec = typeof AutomationSpecSchema.Type;

export const AutomationRunReasonSchema = Schema.Literals(["scheduled", "catch_up", "manual"]);
export type AutomationRunReason = typeof AutomationRunReasonSchema.Type;

export const AutomationRunStatusSchema = Schema.Literals(["started", "failed", "skipped"]);
export type AutomationRunStatus = typeof AutomationRunStatusSchema.Type;

export const AutomationSkipReasonSchema = Schema.Literals([
  "in_progress",
  "stale",
  "project_missing",
]);
export type AutomationSkipReason = typeof AutomationSkipReasonSchema.Type;

export const AutomationRunSchema = Schema.Struct({
  id: Schema.String,
  startedAt: Schema.String,
  reason: AutomationRunReasonSchema,
  status: AutomationRunStatusSchema,
  sessionId: Schema.optionalKey(Schema.String),
  error: Schema.optionalKey(Schema.String),
  skipReason: Schema.optionalKey(AutomationSkipReasonSchema),
});
export type AutomationRun = typeof AutomationRunSchema.Type;

export const AutomationSchema = Schema.Struct({
  id: Schema.String.check(Schema.isUUID()),
  name: Schema.String,
  projectId: Schema.String.check(Schema.isUUID()),
  prompt: Schema.String,
  spec: AutomationSpecSchema,
  enabled: Schema.Boolean,
  worktree: Schema.optionalKey(CreateWorktreeInputSchema),
  provider: Schema.optionalKey(Schema.NonEmptyString),
  modelId: Schema.optionalKey(Schema.NonEmptyString),
  createdAt: Schema.String,
  updatedAt: Schema.String,
  nextRunAt: Schema.Union([Schema.String, Schema.Null]),
  lastRunAt: Schema.optionalKey(Schema.String),
  lastRunStatus: Schema.optionalKey(AutomationRunStatusSchema),
  lastSessionId: Schema.optionalKey(Schema.String),
  lastError: Schema.optionalKey(Schema.String),
  runs: Schema.Array(AutomationRunSchema),
});
export type Automation = typeof AutomationSchema.Type;

const automationName = Schema.String.check(
  Schema.isTrimmed(),
  Schema.isNonEmpty(),
  Schema.isMaxLength(MAX_AUTOMATION_NAME_CHARS),
);

const automationPrompt = Schema.String.check(
  Schema.isTrimmed(),
  Schema.isNonEmpty(),
  Schema.isMaxLength(MAX_AUTOMATION_PROMPT_CHARS),
);

export const CreateAutomationInputSchema = Schema.Struct({
  name: automationName,
  projectId: Schema.String.check(Schema.isUUID()),
  prompt: automationPrompt,
  spec: AutomationSpecSchema,
  enabled: Schema.optionalKey(Schema.Boolean),
  worktree: Schema.optionalKey(CreateWorktreeInputSchema),
  provider: Schema.optionalKey(Schema.NonEmptyString),
  modelId: Schema.optionalKey(Schema.NonEmptyString),
});
export type CreateAutomationInput = typeof CreateAutomationInputSchema.Type;

export const UpdateAutomationInputSchema = Schema.Struct({
  id: Schema.String.check(Schema.isUUID()),
  name: Schema.optionalKey(automationName),
  prompt: Schema.optionalKey(automationPrompt),
  spec: Schema.optionalKey(AutomationSpecSchema),
  enabled: Schema.optionalKey(Schema.Boolean),
  worktree: Schema.optionalKey(CreateWorktreeInputSchema),
  provider: Schema.optionalKey(Schema.NonEmptyString),
  modelId: Schema.optionalKey(Schema.NonEmptyString),
});
export type UpdateAutomationInput = typeof UpdateAutomationInputSchema.Type;

export const AutomationIdInputSchema = Schema.Struct({
  id: Schema.String.check(Schema.isUUID()),
});
export type AutomationIdInput = typeof AutomationIdInputSchema.Type;

export const RunAutomationOutputSchema = Schema.Struct({
  automation: AutomationSchema,
  ref: Schema.optionalKey(SessionRefSchema),
});
export type RunAutomationOutput = typeof RunAutomationOutputSchema.Type;

export const automationContract = {
  list: base.output(toStandardSchema(Schema.Array(AutomationSchema))),
  get: base
    .input(toStandardSchema(AutomationIdInputSchema))
    .output(toStandardSchema(AutomationSchema)),
  create: base
    .input(toStandardSchema(CreateAutomationInputSchema))
    .output(toStandardSchema(AutomationSchema)),
  update: base
    .input(toStandardSchema(UpdateAutomationInputSchema))
    .output(toStandardSchema(AutomationSchema)),
  delete: base.input(toStandardSchema(AutomationIdInputSchema)),
  runNow: base
    .input(toStandardSchema(AutomationIdInputSchema))
    .output(toStandardSchema(RunAutomationOutputSchema)),
};
