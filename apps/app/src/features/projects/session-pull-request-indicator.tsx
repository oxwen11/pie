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
    Icon: GitPullRequestIcon,
    label: "Open pull request",
  },
  draft: {
    Icon: GitPullRequestDraftIcon,
    label: "Draft pull request",
  },
  closed: {
    Icon: GitPullRequestClosedIcon,
    label: "Closed pull request",
  },
  merged: {
    Icon: GitMergeIcon,
    label: "Pull request merged",
  },
} as const;

const indicatorColor = {
  open: "text-pull-request-open hover:text-pull-request-open peer-hover/menu-button:text-pull-request-open",
  draft:
    "text-pull-request-draft hover:text-pull-request-draft peer-hover/menu-button:text-pull-request-draft",
  closed:
    "text-pull-request-closed hover:text-pull-request-closed peer-hover/menu-button:text-pull-request-closed",
  merged:
    "text-pull-request-merged hover:text-pull-request-merged peer-hover/menu-button:text-pull-request-merged",
  unknown:
    "text-muted-foreground hover:text-muted-foreground peer-hover/menu-button:text-muted-foreground",
} as const;

function indicatorView(status: PullRequestSessionStatus | undefined) {
  const projection = projectSessionPullRequests(status?.links ?? []);
  const link = projection.representative;
  if (!link) return null;
  const lifecycle = projection.lifecycle;
  const state =
    lifecycle?.type === "open" && lifecycle.draft ? "draft" : (lifecycle?.type ?? "unknown");
  const { Icon, label } =
    state === "unknown"
      ? { Icon: GitPullRequestIcon, label: "Pull request status unknown" }
      : presentations[state];
  const badge =
    projection.badge === "stack"
      ? `Stack · ${projection.count}`
      : `#${link.ref.number}${projection.count > 1 ? ` +${projection.count - 1}` : ""}`;
  const checked = link.snapshot?.checkedAt;
  const failure =
    status?.state === "error"
      ? ` Update failed: ${status.error ?? "Retry in the Pull requests panel."}`
      : status?.state === "pending"
        ? " Updating."
        : "";
  return {
    Icon,
    color: indicatorColor[state],
    badge,
    href: pullRequestUrl(link.ref),
    description: `${badge}: ${label}. ${checked ? `Last checked ${checked}.` : "Not yet verified."}${failure}`,
  };
}

/** Every row uses the same cached projection, including the selected session. */
export function SessionPullRequestIndicator({
  status,
}: {
  readonly status: PullRequestSessionStatus | undefined;
}) {
  const view = indicatorView(status);
  if (!view) return null;
  const { Icon, color, badge, href, description } = view;
  return (
    <SidebarMenuAction
      className="w-auto max-w-24 px-1 text-xs"
      render={
        <a
          aria-label={description}
          className={color}
          href={href}
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
