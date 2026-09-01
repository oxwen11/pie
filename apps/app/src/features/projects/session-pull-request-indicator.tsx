import type { PullRequestLifecycle } from "@getpie/contract/pull-request";
import {
  GitMergeIcon,
  GitPullRequestClosedIcon,
  GitPullRequestDraftIcon,
  GitPullRequestIcon,
} from "lucide-react";

const presentations = {
  open: {
    color: "text-pull-request-open",
    Icon: GitPullRequestIcon,
    label: "Open pull request",
  },
  draft: {
    color: "text-pull-request-draft",
    Icon: GitPullRequestDraftIcon,
    label: "Draft pull request",
  },
  closed: {
    color: "text-pull-request-closed",
    Icon: GitPullRequestClosedIcon,
    label: "Closed pull request",
  },
  merged: {
    color: "text-pull-request-merged",
    Icon: GitMergeIcon,
    label: "Pull request merged",
  },
} as const;

/** PR lifecycle for one session workspace. No icon when none is available to display. */
export function SessionPullRequestIndicator({
  lifecycle,
}: {
  readonly lifecycle: PullRequestLifecycle | undefined;
}) {
  if (lifecycle === undefined) return null;

  const state = lifecycle.type === "open" && lifecycle.draft ? "draft" : lifecycle.type;
  const { color, Icon, label } = presentations[state];

  return (
    <span aria-label={label} className={`${color} shrink-0`} role="img" title={label}>
      <Icon aria-hidden className="size-3.5" />
    </span>
  );
}
