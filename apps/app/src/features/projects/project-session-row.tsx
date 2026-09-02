import type { Schedule, SessionSummary } from "@getpie/contract";
import type { PullRequestLifecycle } from "@getpie/contract/pull-request";
import { SidebarMenuButton, SidebarMenuItem } from "@getpie/ui/components/sidebar";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useRouteContext } from "@tanstack/react-router";
import { Clock } from "lucide-react";
import { useCallback } from "react";

import { collectFiredSessionIds } from "@/features/projects/fired-session-ids";
import { SessionActionsMenu } from "@/features/projects/session-actions-menu";
import { SessionPullRequestIndicator } from "@/features/projects/session-pull-request-indicator";
import { SessionStatusIndicator } from "@/features/projects/session-status-indicator";

export type SessionPullRequest = {
  readonly lifecycle: PullRequestLifecycle;
  readonly url: string;
};

/** One session row: open-session navigation plus composed session actions. */
export function ProjectSessionRow({
  active,
  isActive,
  pullRequest,
  session,
}: {
  readonly active: boolean;
  readonly isActive: () => boolean;
  readonly pullRequest: SessionPullRequest | undefined;
  readonly session: SessionSummary;
}) {
  const navigate = useNavigate();
  const { orpcQueryUtils } = useRouteContext({ from: "__root__" });
  // Closes over this row's sessionId so only a boolean change re-renders.
  const selectCreatedBySchedule = useCallback(
    (schedules: ReadonlyArray<Schedule>) =>
      collectFiredSessionIds(schedules).has(session.sessionId),
    [session.sessionId],
  );
  const createdBySchedule = useQuery({
    ...orpcQueryUtils.schedule.list.queryOptions(),
    select: selectCreatedBySchedule,
    refetchInterval: 10_000,
  });

  return (
    <SidebarMenuItem>
      <SessionActionsMenu
        isActive={isActive}
        session={session}
        render={
          <SidebarMenuButton
            // Hover-only archive must not keep the default pe-8 gap; a PR icon
            // is a lasting action and still needs that padding.
            className={
              pullRequest === undefined
                ? "md:group-has-data-[sidebar=menu-action]/menu-item:pe-2"
                : undefined
            }
            isActive={active}
            onClick={() => {
              navigate({
                to: "/session/$sessionId",
                params: { sessionId: session.sessionId },
                search: { projectId: session.projectId },
              }).catch((error: unknown) => {
                console.error("Failed to open session", error);
              });
            }}
          />
        }
      >
        <SessionStatusIndicator phase={session.status?.phase} />
        <span className="min-w-0 flex-1 truncate">{session.title ?? "New chat"}</span>
        {createdBySchedule.data === true ? (
          <span
            className="text-muted-foreground inline-flex shrink-0"
            title="Created by a schedule"
          >
            <Clock aria-hidden className="size-3.5 opacity-70" />
          </span>
        ) : null}
      </SessionActionsMenu>
      <SessionPullRequestIndicator lifecycle={pullRequest?.lifecycle} url={pullRequest?.url} />
    </SidebarMenuItem>
  );
}
