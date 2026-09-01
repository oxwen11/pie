import type {
  PullRequestCheck,
  PullRequestCheckStatus,
  PullRequestMergeMethod,
  PullRequestOfferedAction,
  PullRequestRef,
  PullRequestReviewDecision,
  PullRequestSnapshot,
} from "@getpie/contract/pull-request";

const MERGE_METHODS = ["merge", "squash", "rebase"] as const;

export class InvalidPullRequestJsonError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidPullRequestJsonError";
  }
}

const asRecord = (value: unknown, field: string): Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new InvalidPullRequestJsonError(`${field} must be an object`);
  }
  return value as Record<string, unknown>;
};

const requiredString = (record: Record<string, unknown>, field: string): string => {
  const value = record[field];
  if (typeof value !== "string") {
    throw new InvalidPullRequestJsonError(`${field} must be a string`);
  }
  return value;
};

const requiredNumber = (record: Record<string, unknown>, field: string): number => {
  const value = record[field];
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new InvalidPullRequestJsonError(`${field} must be a positive integer`);
  }
  return value;
};

const requiredBoolean = (record: Record<string, unknown>, field: string): boolean => {
  const value = record[field];
  if (typeof value !== "boolean") {
    throw new InvalidPullRequestJsonError(`${field} must be a boolean`);
  }
  return value;
};

const optionalString = (record: Record<string, unknown>, field: string): string | null => {
  const value = record[field];
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") {
    throw new InvalidPullRequestJsonError(`${field} must be a string or null`);
  }
  return value;
};

export const parsePullRequestRef = (value: string, expectedNumber: number): PullRequestRef => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new InvalidPullRequestJsonError("url must be an absolute URL");
  }
  if (url.protocol !== "https:") {
    throw new InvalidPullRequestJsonError("pull request url must use https");
  }
  const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  if (parts.length < 4 || parts.at(-2) !== "pull") {
    throw new InvalidPullRequestJsonError("url is not a pull request URL");
  }
  const number = Number(parts.at(-1));
  const repository = parts.at(-3);
  const owner = parts.at(-4);
  if (!Number.isInteger(number) || number < 1 || number !== expectedNumber) {
    throw new InvalidPullRequestJsonError("url pull request number does not match number");
  }
  if (!owner || !repository) {
    throw new InvalidPullRequestJsonError("url is missing repository identity");
  }
  return { host: url.host, owner, repository, number };
};

const normalizeMergeMethod = (value: unknown): PullRequestMergeMethod => {
  switch (value) {
    case "MERGE":
      return "merge";
    case "SQUASH":
      return "squash";
    case "REBASE":
      return "rebase";
    default:
      throw new InvalidPullRequestJsonError("autoMergeRequest.mergeMethod is unsupported");
  }
};

const normalizeReviewDecision = (value: unknown): PullRequestReviewDecision => {
  switch (value) {
    case "APPROVED":
      return "approved";
    case "CHANGES_REQUESTED":
      return "changes-requested";
    case "REVIEW_REQUIRED":
      return "review-required";
    case "":
    case null:
    case undefined:
      return "none";
    default:
      throw new InvalidPullRequestJsonError("reviewDecision is unsupported");
  }
};

const checkRunStatus = (record: Record<string, unknown>): PullRequestCheckStatus => {
  const status = requiredString(record, "status");
  if (status !== "COMPLETED") return "pending";
  switch (optionalString(record, "conclusion")) {
    case "SUCCESS":
      return "success";
    case "FAILURE":
    case "TIMED_OUT":
    case "ACTION_REQUIRED":
    case "STARTUP_FAILURE":
    case "STALE":
      return "failure";
    case "CANCELLED":
      return "cancelled";
    case "SKIPPED":
      return "skipped";
    case "NEUTRAL":
    case null:
      return "neutral";
    default:
      return "neutral";
  }
};

const statusContextStatus = (record: Record<string, unknown>): PullRequestCheckStatus => {
  switch (requiredString(record, "state")) {
    case "EXPECTED":
    case "PENDING":
      return "pending";
    case "SUCCESS":
      return "success";
    case "ERROR":
    case "FAILURE":
      return "failure";
    default:
      return "neutral";
  }
};

const normalizeCheck = (value: unknown, index: number): PullRequestCheck => {
  const record = asRecord(value, `statusCheckRollup[${index}]`);
  const typename = optionalString(record, "__typename");
  if (typename === "StatusContext" || "context" in record) {
    return {
      name: requiredString(record, "context"),
      status: statusContextStatus(record),
      description: optionalString(record, "description"),
      url: optionalString(record, "targetUrl"),
    };
  }
  return {
    name: requiredString(record, "name"),
    status: checkRunStatus(record),
    description: optionalString(record, "workflowName"),
    url: optionalString(record, "detailsUrl"),
  };
};

export const summarizeChecks = (
  checks: ReadonlyArray<PullRequestCheck>,
): PullRequestSnapshot["checks"]["summary"] => {
  if (checks.some((check) => check.status === "failure" || check.status === "cancelled")) {
    return "failing";
  }
  if (checks.some((check) => check.status === "pending")) return "pending";
  if (checks.some((check) => check.status === "success")) return "passing";
  return "none";
};

const offeredActions = (
  lifecycle: PullRequestSnapshot["lifecycle"],
  mergeability: PullRequestSnapshot["mergeability"],
  autoMerge: PullRequestSnapshot["autoMerge"],
): ReadonlyArray<PullRequestOfferedAction> => {
  if (lifecycle.type !== "open" || lifecycle.draft) return [];
  if (autoMerge !== null) return [{ type: "disable-auto-merge" }];
  if (mergeability === "conflicting") return [];
  return [
    { type: "merge", methods: MERGE_METHODS },
    { type: "enable-auto-merge", methods: MERGE_METHODS },
  ];
};

export function normalizeGitHubPullRequestJson(input: unknown): PullRequestSnapshot {
  const record = asRecord(input, "pull request");
  const number = requiredNumber(record, "number");
  const url = requiredString(record, "url");
  const state = requiredString(record, "state");
  const isDraft = requiredBoolean(record, "isDraft");
  const lifecycle: PullRequestSnapshot["lifecycle"] =
    state === "OPEN"
      ? { type: "open", draft: isDraft }
      : state === "CLOSED"
        ? { type: "closed" }
        : state === "MERGED"
          ? { type: "merged" }
          : (() => {
              throw new InvalidPullRequestJsonError("state is unsupported");
            })();
  const mergeable = (() => {
    switch (requiredString(record, "mergeable")) {
      case "MERGEABLE":
        return "mergeable" as const;
      case "CONFLICTING":
        return "conflicting" as const;
      default:
        return "unknown" as const;
    }
  })();
  const rollup = record.statusCheckRollup;
  if (!Array.isArray(rollup)) {
    throw new InvalidPullRequestJsonError("statusCheckRollup must be an array");
  }
  const checks = rollup.map(normalizeCheck);
  const autoMergeRecord = record.autoMergeRequest;
  const autoMerge =
    autoMergeRecord === null || autoMergeRecord === undefined
      ? null
      : { method: normalizeMergeMethod(asRecord(autoMergeRecord, "autoMergeRequest").mergeMethod) };

  return {
    ref: parsePullRequestRef(url, number),
    title: requiredString(record, "title"),
    url,
    head: {
      branch: requiredString(record, "headRefName"),
      sha: requiredString(record, "headRefOid"),
    },
    baseBranch: requiredString(record, "baseRefName"),
    lifecycle,
    mergeability: mergeable,
    checks: { summary: summarizeChecks(checks), items: checks },
    reviewDecision: normalizeReviewDecision(record.reviewDecision),
    autoMerge,
    offeredActions: offeredActions(lifecycle, mergeable, autoMerge),
    updatedAt: requiredString(record, "updatedAt"),
  };
}
