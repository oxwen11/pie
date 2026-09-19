import { Schema } from "effect";

import { SessionRefSchema } from "./domain";
import { oc, toStandardSchema } from "./orpc";

export const PullRequestRefSchema = Schema.Struct({
  host: Schema.String.check(Schema.isPattern(/^[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?$/)),
  owner: Schema.String.check(Schema.isPattern(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/)),
  repository: Schema.String.check(Schema.isPattern(/^[a-zA-Z0-9_][a-zA-Z0-9_.-]*$/)),
  number: Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0)),
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

export const PullRequestSummarySchema = Schema.Struct({
  ref: PullRequestRefSchema,
  title: Schema.String,
  headBranch: Schema.String,
  baseBranch: Schema.String,
  lifecycle: PullRequestLifecycleSchema,
  checkedAt: Schema.String,
});
export type PullRequestSummary = typeof PullRequestSummarySchema.Type;

export const PullRequestStackLayerSchema = Schema.Struct({
  ref: PullRequestRefSchema,
  headBranch: Schema.String,
  lifecycle: Schema.NullOr(PullRequestLifecycleSchema),
});
export const PullRequestStackSchema = Schema.Struct({
  id: Schema.String,
  number: Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0)),
  baseBranch: Schema.String,
  // Native host order, bottom to top. Never inferred from PR numbers.
  layers: Schema.Array(PullRequestStackLayerSchema).check(Schema.isMaxLength(100)),
});
export type PullRequestStack = typeof PullRequestStackSchema.Type;
export const PullRequestLinkSourceSchema = Schema.Literals(["agent", "branch", "stack"]);
export type PullRequestLinkSource = typeof PullRequestLinkSourceSchema.Type;
export const SessionPullRequestLinkSchema = Schema.Struct({
  ref: PullRequestRefSchema,
  source: PullRequestLinkSourceSchema,
  linkedAt: Schema.String,
  excluded: Schema.Boolean,
  snapshot: Schema.NullOr(PullRequestSummarySchema),
  stack: Schema.NullOr(PullRequestStackSchema),
  stackCheckedAt: Schema.NullOr(Schema.String),
});
export type SessionPullRequestLink = typeof SessionPullRequestLinkSchema.Type;
export const PullRequestSessionStatusSchema = Schema.Struct({
  ref: SessionRefSchema,
  links: Schema.Array(SessionPullRequestLinkSchema),
  state: Schema.Literals(["idle", "pending", "ready", "unbound", "error"]),
  error: Schema.optionalKey(Schema.String),
});
export type PullRequestSessionStatus = typeof PullRequestSessionStatusSchema.Type;

export const PullRequestStackActionSchema = Schema.Literals(["merge", "rebase"]);
export type PullRequestStackAction = typeof PullRequestStackActionSchema.Type;
export const PullRequestStackExpectedSchema = Schema.Struct({
  stackId: Schema.String,
  baseBranch: Schema.String,
  // Entire native topology plus heads, not just the affected subset.
  members: Schema.Array(
    Schema.Struct({
      pullRequest: PullRequestRefSchema,
      headBranch: Schema.String,
      headSha: Schema.String,
    }),
  ).check(Schema.isMaxLength(100)),
});
export type PullRequestStackExpected = typeof PullRequestStackExpectedSchema.Type;
export const PullRequestStackPreviewSchema = Schema.Struct({
  pullRequest: PullRequestRefSchema,
  action: PullRequestStackActionSchema,
  stack: PullRequestStackSchema,
  expected: PullRequestStackExpectedSchema,
  affected: Schema.Array(PullRequestRefSchema),
  methods: Schema.Array(PullRequestMergeMethodSchema),
  allowed: Schema.Boolean,
  reason: Schema.optionalKey(Schema.String),
});
export type PullRequestStackPreview = typeof PullRequestStackPreviewSchema.Type;
export const PullRequestStackActionResultSchema = Schema.Struct({
  action: PullRequestStackActionSchema,
  completed: Schema.Array(PullRequestRefSchema),
  outcome: Schema.Literals(["applied", "partial", "unknown"]),
  message: Schema.optionalKey(Schema.String),
});
export type PullRequestStackActionResult = typeof PullRequestStackActionResultSchema.Type;
export const PullRequestDemandInputSchema = Schema.Struct({
  leaseId: Schema.optionalKey(Schema.String),
  version: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  refs: Schema.Array(SessionRefSchema).check(Schema.isMaxLength(100)),
});
export type PullRequestDemandInput = typeof PullRequestDemandInputSchema.Type;
export const PullRequestDemandOutputSchema = Schema.Struct({
  leaseId: Schema.String,
  expiresAt: Schema.String,
});
export type PullRequestDemandOutput = typeof PullRequestDemandOutputSchema.Type;

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
    .input(Schema.Struct({ refs: Schema.Array(SessionRefSchema).check(Schema.isMaxLength(100)) }))
    .errors(currentErrors)
    .output(Schema.Array(PullRequestSessionStatusSchema)),
  demand: oc
    .input(PullRequestDemandInputSchema)
    .errors({ ...currentErrors, INVALID_LEASE: {} })
    .output(PullRequestDemandOutputSchema),
  refresh: oc
    .input(Schema.Struct({ ref: SessionRefSchema }))
    .errors(currentErrors)
    .output(PullRequestSessionStatusSchema),
  exclude: oc
    .input(Schema.Struct({ ref: SessionRefSchema, pullRequest: PullRequestRefSchema }))
    .errors({ ...currentErrors, STORE_WRITE_FAILED: {} })
    .output(Schema.Void),
  detail: oc
    .input(Schema.Struct({ ref: SessionRefSchema, pullRequest: PullRequestRefSchema }))
    .errors({ ...currentErrors, STALE_CONTEXT: {} })
    .output(Schema.NullOr(PullRequestSnapshotSchema)),
  stackPreview: oc
    .input(
      Schema.Struct({
        ref: SessionRefSchema,
        pullRequest: PullRequestRefSchema,
        action: PullRequestStackActionSchema,
      }),
    )
    .errors(actionErrors)
    .output(PullRequestStackPreviewSchema),
  runStackAction: oc
    .input(
      Schema.Struct({
        ref: SessionRefSchema,
        pullRequest: PullRequestRefSchema,
        action: PullRequestStackActionSchema,
        expected: PullRequestStackExpectedSchema,
        method: Schema.optionalKey(PullRequestMergeMethodSchema),
      }),
    )
    .errors(actionErrors)
    .output(PullRequestStackActionResultSchema),
  runAction: oc
    .input(PullRequestActionInputSchema)
    .errors(actionErrors)
    .output(PullRequestActionAppliedSchema),
};

/** Canonical identity; branch spelling is deliberately untouched. */
export const normalizePullRequestRef = (ref: PullRequestRef): PullRequestRef => ({
  host: ref.host.toLowerCase(),
  owner: ref.owner.toLowerCase(),
  repository: ref.repository.toLowerCase(),
  number: ref.number,
});
export const pullRequestKey = (ref: PullRequestRef): string => {
  const normalized = normalizePullRequestRef(ref);
  return `${normalized.host}/${normalized.owner}/${normalized.repository}#${normalized.number}`;
};
export const pullRequestUrl = (ref: PullRequestRef): string =>
  `https://${ref.host}/${ref.owner}/${ref.repository}/pull/${ref.number}`;

export type PullRequestGroup = {
  readonly type: "native" | "single";
  readonly links: ReadonlyArray<SessionPullRequestLink>;
  readonly stack: PullRequestStack | null;
};
export type PullRequestProjection = {
  readonly groups: ReadonlyArray<PullRequestGroup>;
  readonly representative: SessionPullRequestLink | null;
  readonly badge: "pr" | "stack" | null;
  readonly count: number;
  readonly lifecycle: PullRequestLifecycle | null;
};

/** Native stacks stay grouped; everything else is an individual association. */
export const projectSessionPullRequests = (
  links: ReadonlyArray<SessionPullRequestLink>,
): PullRequestProjection => {
  const visible = links
    .filter((link) => !link.excluded)
    .sort((a, b) => a.linkedAt.localeCompare(b.linkedAt));
  const remaining = new Map(visible.map((link) => [pullRequestKey(link.ref), link]));
  const groups: PullRequestGroup[] = [];
  for (const link of visible) {
    if (!link.stack || !remaining.has(pullRequestKey(link.ref))) continue;
    const members = link.stack.layers.flatMap((layer) => {
      const member = remaining.get(pullRequestKey(layer.ref));
      return member ? [member] : [];
    });
    if (members.length === 0) continue;
    for (const member of members) remaining.delete(pullRequestKey(member.ref));
    groups.push({ type: "native", links: members, stack: link.stack });
  }
  for (const link of remaining.values())
    groups.push({ type: "single", links: [link], stack: null });
  const unfinished = (link: SessionPullRequestLink) =>
    link.snapshot === null || link.snapshot.lifecycle.type === "open";
  const chain = groups.length === 1 && groups[0]?.type === "native" ? groups[0] : undefined;
  const representative = chain
    ? (chain.links.findLast(unfinished) ?? chain.links.at(-1) ?? null)
    : (visible.find(unfinished) ?? visible[0] ?? null);
  const lifecycle = visible.some((link) => link.snapshot === null)
    ? null
    : (representative?.snapshot?.lifecycle ?? null);
  return {
    groups,
    representative,
    badge: visible.length === 0 ? null : chain ? "stack" : "pr",
    count: visible.length,
    lifecycle,
  };
};
