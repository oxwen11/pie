import type { SessionRef } from "@getpie/contract";
import type {
  PullRequestAction,
  PullRequestActionInput,
  PullRequestSnapshot,
} from "@getpie/contract/pull-request";

export interface PullRequestHeaderStatus {
  readonly label: string;
  readonly tone: "positive" | "warning" | "negative" | "muted" | "accent";
}

export type PullRequestSessionState = "open" | "draft" | "closed" | "merged";

export function pullRequestSessionState(
  snapshot: PullRequestSnapshot | null,
): PullRequestSessionState | undefined {
  if (snapshot === null) return undefined;
  if (snapshot.lifecycle.type !== "open") return snapshot.lifecycle.type;
  return snapshot.lifecycle.draft ? "draft" : "open";
}

export function pullRequestHeaderStatus(
  snapshot: PullRequestSnapshot | null,
): PullRequestHeaderStatus | undefined {
  if (snapshot === null) return undefined;
  if (snapshot.lifecycle.type === "merged") return { label: "Merged", tone: "accent" };
  if (snapshot.lifecycle.type === "closed") return { label: "Closed", tone: "negative" };
  if (snapshot.lifecycle.draft) return { label: "Draft", tone: "muted" };
  if (snapshot.mergeability === "conflicting") {
    return { label: "Conflicts", tone: "negative" };
  }
  switch (snapshot.checks.summary) {
    case "failing":
      return { label: "Checks failing", tone: "negative" };
    case "pending":
      return { label: "Checks pending", tone: "warning" };
    case "passing":
      return { label: "Checks passing", tone: "positive" };
    case "none":
      return { label: "Open", tone: "muted" };
  }
}

export const pullRequestActionInput = (
  ref: SessionRef,
  snapshot: PullRequestSnapshot,
  action: PullRequestAction,
): PullRequestActionInput => {
  switch (action.type) {
    case "merge":
      return {
        ref,
        expected: { pullRequest: snapshot.ref, headSha: snapshot.head.sha },
        action,
      };
    case "enable-auto-merge":
      return {
        ref,
        expected: { pullRequest: snapshot.ref, headSha: snapshot.head.sha },
        action,
      };
    case "disable-auto-merge":
      return { ref, expected: { pullRequest: snapshot.ref }, action };
  }
};

export const pullRequestLifecycleLabel = (snapshot: PullRequestSnapshot): string => {
  if (snapshot.lifecycle.type === "merged") return "Merged";
  if (snapshot.lifecycle.type === "closed") return "Closed";
  return snapshot.lifecycle.draft ? "Draft" : "Open";
};

export const pullRequestReviewLabel = (snapshot: PullRequestSnapshot): string => {
  switch (snapshot.reviewDecision) {
    case "approved":
      return "Approved";
    case "changes-requested":
      return "Changes requested";
    case "review-required":
      return "Review required";
    case "none":
      return "No review decision";
  }
};
