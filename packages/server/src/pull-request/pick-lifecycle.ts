import type { PullRequestLifecycle, PullRequestSnapshot } from "@getpie/contract/pull-request";

/** Prefer the last still-open PR; otherwise the last resolved snapshot. */
export const pickSessionPullRequestLifecycle = (
  snapshots: ReadonlyArray<PullRequestSnapshot | null>,
): PullRequestLifecycle | undefined => {
  let last: PullRequestLifecycle | undefined;
  let lastOpen: PullRequestLifecycle | undefined;
  for (const snapshot of snapshots) {
    if (snapshot === null) continue;
    last = snapshot.lifecycle;
    if (snapshot.lifecycle.type === "open") lastOpen = snapshot.lifecycle;
  }
  return lastOpen ?? last;
};
