import type { SessionSummary } from "@getpie/contract";
import type { PullRequestSessionStatus } from "@getpie/contract/pull-request";
import { SidebarMenuButton, SidebarMenuItem } from "@getpie/ui/components/sidebar";
import { useNavigate } from "@tanstack/react-router";
import { Clock } from "lucide-react";

import { usePullRequestRow } from "@/components/layout/pull-request-demand-provider";
import { SessionActionsMenu } from "@/features/projects/session-actions-menu";
import { SessionPullRequestIndicator } from "@/features/projects/session-pull-request-indicator";
import { SessionStatusIndicator } from "@/features/projects/session-status-indicator";

export type SessionPullRequest = PullRequestSessionStatus;

/** One session row: open-session navigation plus composed session actions. */
export function ProjectSessionRow({
  active,
  createdBySchedule = false,
  environmentId,
  isActive,
  pullRequest,
  session,
}: {
  readonly active: boolean;
  readonly createdBySchedule?: boolean;
  readonly environmentId: string;
  readonly isActive: () => boolean;
  readonly pullRequest: SessionPullRequest | undefined;
  readonly session: SessionSummary;
}) {
  const navigate = useNavigate();
  const observe = usePullRequestRow(session, true);

  return (
    <SidebarMenuItem
      // The item carries the highlight, not the button: the button ends before the badge.
      className="hover:bg-sidebar-accent data-[active=true]:bg-sidebar-accent flex items-center gap-1 rounded-lg"
      data-active={active}
      ref={observe}
    >
      <SessionActionsMenu
        environmentId={environmentId}
        isActive={isActive}
        session={session}
        render={
          <SidebarMenuButton
            className="group-hover/menu-item:text-sidebar-accent-foreground min-w-0 flex-1 md:group-has-data-[sidebar=menu-action]/menu-item:pe-2"
            isActive={active}
            onClick={() => {
              navigate({
                to: "/session/$sessionId",
                params: { sessionId: session.sessionId },
                search: { projectId: session.projectId, environmentId },
              }).catch((error: unknown) => {
                console.error("Failed to open session", error);
              });
            }}
          />
        }
      >
        <SessionStatusIndicator phase={session.status?.phase} />
        <span className="min-w-0 flex-1 truncate">{session.title ?? "New chat"}</span>
        {createdBySchedule ? (
          <span
            className="text-muted-foreground inline-flex shrink-0"
            title="Created by a schedule"
          >
            <Clock aria-hidden className="size-3.5 opacity-70" />
          </span>
        ) : null}
      </SessionActionsMenu>
      <SessionPullRequestIndicator status={pullRequest} />
    </SidebarMenuItem>
  );
}
