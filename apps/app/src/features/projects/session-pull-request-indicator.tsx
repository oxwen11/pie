import {
  projectSessionPullRequests,
  pullRequestUrl,
  type PullRequestSessionStatus,
} from "@getpie/contract/pull-request";
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

/** Every row uses the same cached projection, including the selected session. */
export function SessionPullRequestIndicator({
  status,
}: {
  readonly status: PullRequestSessionStatus | undefined;
}) {
  const projection = projectSessionPullRequests(status?.links ?? []);
  const link = projection.representative;
  if (!link) return null;
  const lifecycle = projection.lifecycle;
  const state = lifecycle?.type === "open" && lifecycle.draft ? "draft" : lifecycle?.type;
  const { color, Icon, label } =
    state === undefined
      ? {
          color: "text-muted-foreground",
          Icon: GitPullRequestIcon,
          label: "Pull request status unknown",
        }
      : presentations[state];
  const badge =
    projection.badge === "stack"
      ? `Stack · ${projection.count}`
      : `#${link.ref.number}${projection.count > 1 ? ` +${projection.count - 1}` : ""}`;
  const checked = link.snapshot?.checkedAt;
  const description = `${badge}: ${label}. ${checked ? `Last checked ${checked}.` : "Not yet verified."}${status?.state === "error" ? ` Update failed: ${status.error ?? "Retry in the Pull requests panel."}` : status?.state === "pending" ? " Updating." : ""}`;

  return (
    <SidebarMenuAction
      className={`${color} w-auto max-w-24 px-1 text-[10px]`}
      render={
        <a
          aria-label={description}
          href={pullRequestUrl(link.ref)}
          rel="noreferrer"
          target="_blank"
          title={description}
        >
          <Icon aria-hidden className="size-3.5 shrink-0" />
          <span className="truncate">{badge}</span>
        </a>
      }
    />
  );
}
