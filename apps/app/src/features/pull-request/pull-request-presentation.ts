import type { SessionRef } from "@getpie/contract";
import type {
  PullRequestAction,
  PullRequestActionInput,
  PullRequestCheckStatus,
  PullRequestListItem,
  PullRequestMergeMethod,
  PullRequestRef,
  PullRequestSnapshot,
} from "@getpie/contract/pull-request";

export type PullRequestSessionState = "open" | "draft" | "closed" | "merged";

export function samePullRequestRef(left: PullRequestRef, right: PullRequestRef): boolean {
  return (
    left.host === right.host &&
    left.owner === right.owner &&
    left.repository === right.repository &&
    left.number === right.number
  );
}

export function pullRequestRepositoryLabel(ref: PullRequestRef): string {
  return `${ref.owner}/${ref.repository}`;
}

export function filterPullRequestItems(
  items: ReadonlyArray<PullRequestListItem>,
  query: string,
): ReadonlyArray<PullRequestListItem> {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return items;
  return items.filter((item) => {
    const haystack = [
      item.title,
      item.headBranch,
      item.baseBranch,
      pullRequestRepositoryLabel(item.ref),
      `#${item.ref.number}`,
      item.authorLogin,
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(needle);
  });
}

export function selectedPullRequest(
  items: ReadonlyArray<PullRequestListItem>,
  visible: ReadonlyArray<PullRequestListItem>,
  selectedRef: PullRequestRef | null,
): PullRequestListItem | undefined {
  if (selectedRef !== null) {
    const match = items.find((item) => samePullRequestRef(item.ref, selectedRef));
    if (match !== undefined) return match;
  }
  return visible[0] ?? items[0];
}

export function pullRequestSessionState(
  snapshot: PullRequestSnapshot | null,
): PullRequestSessionState | undefined {
  if (snapshot === null) return undefined;
  if (snapshot.lifecycle.type !== "open") return snapshot.lifecycle.type;
  return snapshot.lifecycle.draft ? "draft" : "open";
}

export const pullRequestActionInput = (
  ref: SessionRef | PullRequestRef,
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

export function checksSummaryLabel(summary: PullRequestSnapshot["checks"]["summary"]): string {
  switch (summary) {
    case "passing":
      return "Checks passing";
    case "pending":
      return "Checks pending";
    case "failing":
      return "Checks failing";
    case "none":
      return "No checks";
    default: {
      const exhaustive: never = summary;
      return exhaustive;
    }
  }
}

export function checkStatusLabel(status: PullRequestCheckStatus): string {
  switch (status) {
    case "success":
      return "Passed";
    case "failure":
      return "Failed";
    case "cancelled":
      return "Cancelled";
    case "pending":
      return "Pending";
    case "skipped":
      return "Skipped";
    case "neutral":
      return "Neutral";
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
}

export function countDiffFiles(patch: string): number {
  let count = 0;
  for (const line of patch.split("\n")) {
    if (line.startsWith("diff --git ")) count += 1;
  }
  return count;
}

export function mergeMethodLabel(method: PullRequestMergeMethod): string {
  switch (method) {
    case "merge":
      return "Merge commit";
    case "squash":
      return "Squash";
    case "rebase":
      return "Rebase";
    default: {
      const exhaustive: never = method;
      return exhaustive;
    }
  }
}

export function mergeMethodActionLabel(method: PullRequestMergeMethod): string {
  switch (method) {
    case "merge":
      return "Merge";
    case "squash":
      return "Squash and merge";
    case "rebase":
      return "Rebase and merge";
    default: {
      const exhaustive: never = method;
      return exhaustive;
    }
  }
}

export function actionConfirmationTitle(action: PullRequestAction): string {
  switch (action.type) {
    case "merge":
      return mergeMethodActionLabel(action.method);
    case "enable-auto-merge":
      return `Enable auto-merge · ${mergeMethodLabel(action.method)}`;
    case "disable-auto-merge":
      return "Disable auto-merge";
    default: {
      const exhaustive: never = action;
      return exhaustive;
    }
  }
}

export function actionConfirmationDescription(input: PullRequestActionInput): string {
  const identity = `${input.expected.pullRequest.owner}/${input.expected.pullRequest.repository}#${input.expected.pullRequest.number}`;
  if ("headSha" in input.expected) {
    return `${identity} at ${input.expected.headSha.slice(0, 12)}. GitHub will reject the action if the head changed.`;
  }
  return `${identity}. GitHub remains authoritative for repository policy.`;
}
