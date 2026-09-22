import type { PullRequestSnapshot } from "@getpie/contract/pull-request";

/** Prefer the last still-open PR; otherwise the last resolved snapshot. */
export const pickSessionPullRequest = (
  snapshots: ReadonlyArray<PullRequestSnapshot | null>,
): PullRequestSnapshot | undefined => {
  let last: PullRequestSnapshot | undefined;
  let lastOpen: PullRequestSnapshot | undefined;
  for (const snapshot of snapshots) {
    if (snapshot === null) continue;
    last = snapshot;
    if (snapshot.lifecycle.type === "open") lastOpen = snapshot;
  }
  return lastOpen ?? last;
};
