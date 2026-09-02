import { Schema, SchemaGetter } from "effect";

import { CreateWorktreeInputSchema, serverErrors, SessionRefSchema } from "./domain";
import { oc } from "./orpc";

const base = oc.errors(serverErrors);

export const MAX_AUTOMATION_NAME_CHARS = 80;
export const MAX_AUTOMATION_PROMPT_CHARS = 25_000;
export const MAX_AUTOMATIONS = 50;
export const MIN_AUTOMATION_EVERY_MS = 60_000;
export const MAX_AUTOMATION_EVERY_MS = 365 * 24 * 60 * 60 * 1000;
export const MAX_AUTOMATION_MAX_RUNS = 10_000;
export const AUTOMATION_CIRCUIT_FAILURES = 3;

export const AutomationCronSpecSchema = Schema.Struct({
  kind: Schema.Literal("cron"),
  /** 5-field cron: minute hour day-of-month month day-of-week. */
  expr: Schema.NonEmptyString,
  /** IANA timezone. Absent means the server's local timezone. */
  timeZone: Schema.optionalKey(Schema.NonEmptyString),
});
export type AutomationCronSpec = typeof AutomationCronSpecSchema.Type;

export const AutomationOnceSpecSchema = Schema.Struct({
  kind: Schema.Literal("once"),
  /** Timezone-aware ISO-8601 instant. */
  runAt: Schema.NonEmptyString,
});
export type AutomationOnceSpec = typeof AutomationOnceSpecSchema.Type;

export const AutomationEverySpecSchema = Schema.Struct({
  kind: Schema.Literal("every"),
  everyMs: Schema.Number.check(
    Schema.isGreaterThanOrEqualTo(MIN_AUTOMATION_EVERY_MS),
    Schema.isLessThanOrEqualTo(MAX_AUTOMATION_EVERY_MS),
  ),
});
export type AutomationEverySpec = typeof AutomationEverySpecSchema.Type;

export const AutomationManualSpecSchema = Schema.Struct({
  kind: Schema.Literal("manual"),
});
export type AutomationManualSpec = typeof AutomationManualSpecSchema.Type;

export const AutomationSpecSchema = Schema.Union([
  AutomationCronSpecSchema,
  AutomationOnceSpecSchema,
  AutomationEverySpecSchema,
  AutomationManualSpecSchema,
]);
export type AutomationSpec = typeof AutomationSpecSchema.Type;

export const AutomationSessionModeSchema = Schema.Literals(["new", "reuse"]);
export type AutomationSessionMode = typeof AutomationSessionModeSchema.Type;

export const AutomationPauseReasonSchema = Schema.Literals([
  "manual",
  "expired",
  "failureCircuit",
  "project_missing",
  "invalid_spec",
  "max_runs",
]);
export type AutomationPauseReason = typeof AutomationPauseReasonSchema.Type;

export const AutomationRunReasonSchema = Schema.Literals([
  "scheduled",
  "catch_up",
  "manual",
  "missed_recovery",
]);
export type AutomationRunReason = typeof AutomationRunReasonSchema.Type;

const StoredRunStatusSchema = Schema.Literals([
  "started",
  "running",
  "succeeded",
  "failed",
  "skipped",
  "missed",
  "interrupted",
]);

export const AutomationRunStatusSchema = StoredRunStatusSchema.pipe(
  Schema.decodeTo(
    Schema.Literals(["running", "succeeded", "failed", "skipped", "missed", "interrupted"]),
    {
      decode: SchemaGetter.transform((status) => (status === "started" ? "running" : status)),
      encode: SchemaGetter.transform((status) => status),
    },
  ),
);
export type AutomationRunStatus = typeof AutomationRunStatusSchema.Type;

export const AutomationSkipReasonSchema = Schema.Literals([
  "in_progress",
  "stale",
  "project_missing",
  "queue_overflow",
  "expired",
  "max_runs",
]);
export type AutomationSkipReason = typeof AutomationSkipReasonSchema.Type;

export const AutomationRunSnapshotSchema = Schema.Struct({
  name: Schema.String,
  prompt: Schema.String,
  projectId: Schema.String,
  spec: AutomationSpecSchema,
  sessionMode: AutomationSessionModeSchema,
  worktree: Schema.optionalKey(CreateWorktreeInputSchema),
  provider: Schema.optionalKey(Schema.NonEmptyString),
  modelId: Schema.optionalKey(Schema.NonEmptyString),
});
export type AutomationRunSnapshot = typeof AutomationRunSnapshotSchema.Type;

export const AutomationRunSchema = Schema.Struct({
  id: Schema.String,
  startedAt: Schema.String,
  reason: AutomationRunReasonSchema,
  status: AutomationRunStatusSchema,
  finishedAt: Schema.optionalKey(Schema.String),
  sessionId: Schema.optionalKey(Schema.String),
  error: Schema.optionalKey(Schema.String),
  skipReason: Schema.optionalKey(AutomationSkipReasonSchema),
  missedCount: Schema.optionalKey(Schema.Number),
  snapshot: Schema.optionalKey(AutomationRunSnapshotSchema),
});
export type AutomationRun = typeof AutomationRunSchema.Type;

const automationMaxRuns = Schema.Number.check(
  Schema.isInt(),
  Schema.isGreaterThanOrEqualTo(1),
  Schema.isLessThanOrEqualTo(MAX_AUTOMATION_MAX_RUNS),
);

export const AutomationSchema = Schema.Struct({
  id: Schema.String.check(Schema.isUUID()),
  name: Schema.String,
  projectId: Schema.String.check(Schema.isUUID()),
  prompt: Schema.String,
  spec: AutomationSpecSchema,
  enabled: Schema.Boolean,
  sessionMode: Schema.optionalKey(AutomationSessionModeSchema),
  expiresAt: Schema.optionalKey(Schema.String),
  maxRuns: Schema.optionalKey(automationMaxRuns),
  firedCount: Schema.optionalKey(
    Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  ),
  pauseReason: Schema.optionalKey(AutomationPauseReasonSchema),
  consecutiveFailures: Schema.optionalKey(Schema.Number),
  reuseSessionId: Schema.optionalKey(Schema.String),
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

export function countsTowardMaxRuns(status: AutomationRunStatus): boolean {
  return (
    status === "running" ||
    status === "succeeded" ||
    status === "failed" ||
    status === "interrupted"
  );
}

export function countFiredRuns(
  runs: ReadonlyArray<{ readonly status: AutomationRunStatus }>,
): number {
  let n = 0;
  for (const run of runs) {
    if (countsTowardMaxRuns(run.status)) n += 1;
  }
  return n;
}

export function firedRunCount(automation: {
  readonly firedCount?: number;
  readonly runs: ReadonlyArray<{ readonly status: AutomationRunStatus }>;
}): number {
  return automation.firedCount ?? countFiredRuns(automation.runs);
}

export function reachedMaxRuns(automation: {
  readonly maxRuns?: number;
  readonly firedCount?: number;
  readonly runs: ReadonlyArray<{ readonly status: AutomationRunStatus }>;
}): boolean {
  return automation.maxRuns !== undefined && firedRunCount(automation) >= automation.maxRuns;
}

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
  sessionMode: Schema.optionalKey(AutomationSessionModeSchema),
  expiresAt: Schema.optionalKey(Schema.String),
  maxRuns: Schema.optionalKey(automationMaxRuns),
  runNow: Schema.optionalKey(Schema.Boolean),
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
  sessionMode: Schema.optionalKey(AutomationSessionModeSchema),
  expiresAt: Schema.optionalKey(Schema.NullOr(Schema.String)),
  maxRuns: Schema.optionalKey(Schema.NullOr(automationMaxRuns)),
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
  list: base.output(Schema.Array(AutomationSchema)),
  get: base.input(AutomationIdInputSchema).output(AutomationSchema),
  create: base.input(CreateAutomationInputSchema).output(AutomationSchema),
  update: base.input(UpdateAutomationInputSchema).output(AutomationSchema),
  delete: base.input(AutomationIdInputSchema),
  runNow: base.input(AutomationIdInputSchema).output(RunAutomationOutputSchema),
};
