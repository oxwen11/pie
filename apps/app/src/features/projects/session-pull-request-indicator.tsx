import type { PullRequestLifecycle } from "@getpie/contract/pull-request";
import { SidebarMenuAction } from "@getpie/ui/components/sidebar";
import {
  GitMergeIcon,
  GitPullRequestClosedIcon,
  GitPullRequestDraftIcon,
  GitPullRequestIcon,
} from "lucide-react";

const presentations = {
  open: {
    color:
      "text-pull-request-open hover:text-pull-request-open peer-hover/menu-button:text-pull-request-open",
    Icon: GitPullRequestIcon,
    label: "Open pull request",
  },
  draft: {
    color:
      "text-pull-request-draft hover:text-pull-request-draft peer-hover/menu-button:text-pull-request-draft",
    Icon: GitPullRequestDraftIcon,
    label: "Draft pull request",
  },
  closed: {
    color:
      "text-pull-request-closed hover:text-pull-request-closed peer-hover/menu-button:text-pull-request-closed",
    Icon: GitPullRequestClosedIcon,
    label: "Closed pull request",
  },
  merged: {
    color:
      "text-pull-request-merged hover:text-pull-request-merged peer-hover/menu-button:text-pull-request-merged",
    Icon: GitMergeIcon,
    label: "Pull request merged",
  },
} as const;

/** PR lifecycle for one session workspace. No icon when none is available to display. */
export function SessionPullRequestIndicator({
  lifecycle,
  url,
}: {
  readonly lifecycle: PullRequestLifecycle | undefined;
  readonly url?: string;
}) {
  if (lifecycle === undefined || url === undefined) return null;

  const state = lifecycle.type === "open" && lifecycle.draft ? "draft" : lifecycle.type;
  const { color, Icon, label } = presentations[state];

  return (
    <SidebarMenuAction
      className={color}
      render={
        <span aria-label={label} role="img" title={label}>
          <Icon aria-hidden className="size-3.5" />
        </span>
      }
    />
  );
}
