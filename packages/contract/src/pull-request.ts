import { Schema } from "effect";

import { SessionRefSchema } from "./domain";
import { oc, toStandardSchema } from "./orpc";

export const PullRequestRefSchema = Schema.Struct({
  host: Schema.String,
  owner: Schema.String,
  repository: Schema.String,
  number: Schema.Number,
});
export type PullRequestRef = typeof PullRequestRefSchema.Type;

export const PullRequestLifecycleSchema = Schema.Union([
  Schema.Struct({ type: Schema.Literal("open"), draft: Schema.Boolean }),
  Schema.Struct({ type: Schema.Literal("closed") }),
  Schema.Struct({ type: Schema.Literal("merged") }),
]);
export type PullRequestLifecycle = typeof PullRequestLifecycleSchema.Type;

export const PullRequestChecksSummarySchema = Schema.Literals([
  "passing",
  "pending",
  "failing",
  "none",
]);
export type PullRequestChecksSummary = typeof PullRequestChecksSummarySchema.Type;

export const PullRequestReviewDecisionSchema = Schema.Literals([
  "approved",
  "changes-requested",
  "review-required",
  "none",
]);
export type PullRequestReviewDecision = typeof PullRequestReviewDecisionSchema.Type;

export const PullRequestMergeMethodSchema = Schema.Literals(["merge", "squash", "rebase"]);
export type PullRequestMergeMethod = typeof PullRequestMergeMethodSchema.Type;

export const PullRequestCheckStatusSchema = Schema.Literals([
  "pending",
  "success",
  "failure",
  "cancelled",
  "skipped",
  "neutral",
]);
export type PullRequestCheckStatus = typeof PullRequestCheckStatusSchema.Type;

export const PullRequestCheckSchema = Schema.Struct({
  name: Schema.String,
  status: PullRequestCheckStatusSchema,
  description: Schema.Union([Schema.String, Schema.Null]),
  url: Schema.Union([Schema.String, Schema.Null]),
});
export type PullRequestCheck = typeof PullRequestCheckSchema.Type;

export const PullRequestOfferedActionSchema = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("merge"),
    methods: Schema.Array(PullRequestMergeMethodSchema),
  }),
  Schema.Struct({
    type: Schema.Literal("enable-auto-merge"),
    methods: Schema.Array(PullRequestMergeMethodSchema),
  }),
  Schema.Struct({ type: Schema.Literal("disable-auto-merge") }),
]);
export type PullRequestOfferedAction = typeof PullRequestOfferedActionSchema.Type;

export const PullRequestSnapshotSchema = Schema.Struct({
  ref: PullRequestRefSchema,
  title: Schema.String,
  url: Schema.String,
  head: Schema.Struct({ branch: Schema.String, sha: Schema.String }),
  baseBranch: Schema.String,
  lifecycle: PullRequestLifecycleSchema,
  mergeability: Schema.Literals(["mergeable", "conflicting", "unknown"]),
  checks: Schema.Struct({
    summary: PullRequestChecksSummarySchema,
    items: Schema.Array(PullRequestCheckSchema),
  }),
  reviewDecision: PullRequestReviewDecisionSchema,
  autoMerge: Schema.Union([Schema.Struct({ method: PullRequestMergeMethodSchema }), Schema.Null]),
  offeredActions: Schema.Array(PullRequestOfferedActionSchema),
  updatedAt: Schema.String,
});
export type PullRequestSnapshot = typeof PullRequestSnapshotSchema.Type;

export const PullRequestSessionStatusSchema = Schema.Struct({
  ref: SessionRefSchema,
  lifecycle: PullRequestLifecycleSchema,
});
export type PullRequestSessionStatus = typeof PullRequestSessionStatusSchema.Type;

const ExpectedPullRequestSchema = Schema.Struct({ pullRequest: PullRequestRefSchema });
const ExpectedPullRequestHeadSchema = Schema.Struct({
  pullRequest: PullRequestRefSchema,
  headSha: Schema.String,
});

export const PullRequestActionInputSchema = Schema.Union([
  Schema.Struct({
    ref: SessionRefSchema,
    expected: ExpectedPullRequestHeadSchema,
    action: Schema.Struct({
      type: Schema.Literal("merge"),
      method: PullRequestMergeMethodSchema,
    }),
  }),
  Schema.Struct({
    ref: SessionRefSchema,
    expected: ExpectedPullRequestHeadSchema,
    action: Schema.Struct({
      type: Schema.Literal("enable-auto-merge"),
      method: PullRequestMergeMethodSchema,
    }),
  }),
  Schema.Struct({
    ref: SessionRefSchema,
    expected: ExpectedPullRequestSchema,
    action: Schema.Struct({ type: Schema.Literal("disable-auto-merge") }),
  }),
]);
export type PullRequestActionInput = typeof PullRequestActionInputSchema.Type;
export type PullRequestAction = PullRequestActionInput["action"];
export type PullRequestExpected = PullRequestActionInput["expected"];

export const PullRequestActionAppliedSchema = Schema.Struct({
  pullRequest: PullRequestRefSchema,
  action: Schema.Literals(["merge", "enable-auto-merge", "disable-auto-merge"]),
  appliedHeadSha: Schema.optionalKey(Schema.String),
});
export type PullRequestActionApplied = typeof PullRequestActionAppliedSchema.Type;

const sessionNotFound = {
  data: toStandardSchema(Schema.Struct({ message: Schema.String })),
};

const currentErrors = {
  SESSION_NOT_FOUND: sessionNotFound,
  MISSING_GH: {},
  UNAUTHENTICATED: {},
  RATE_LIMITED: {},
  UNSUPPORTED_CONTEXT: {},
  HOST_UNAVAILABLE: {},
  INVALID_RESPONSE: {},
};

const actionErrors = {
  SESSION_NOT_FOUND: sessionNotFound,
  STALE_CONTEXT: {},
  MISSING_GH: {},
  UNAUTHENTICATED: {},
  RATE_LIMITED: {},
  UNSUPPORTED_CONTEXT: {},
  UNSUPPORTED_ACTION: {},
  OUTCOME_UNKNOWN: {},
  HOST_UNAVAILABLE: {},
  INVALID_RESPONSE: {},
  HOST_REJECTED: {},
};

export const pullRequestContract = {
  current: oc
    .input(Schema.Struct({ ref: SessionRefSchema }))
    .errors(currentErrors)
    .output(Schema.Union([PullRequestSnapshotSchema, Schema.Null])),
  statuses: oc
    .input(Schema.Struct({ refs: Schema.Array(SessionRefSchema) }))
    .errors(currentErrors)
    .output(Schema.Array(PullRequestSessionStatusSchema)),
  runAction: oc
    .input(PullRequestActionInputSchema)
    .errors(actionErrors)
    .output(PullRequestActionAppliedSchema),
};
