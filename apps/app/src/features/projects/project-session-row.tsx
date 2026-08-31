import type { SessionSummary } from "@getpie/contract";
import type { PullRequestLifecycle } from "@getpie/contract/pull-request";
import { SidebarMenuButton, SidebarMenuItem } from "@getpie/ui/components/sidebar";
import { useNavigate } from "@tanstack/react-router";

import { SessionActionsMenu } from "@/features/projects/session-actions-menu";
import { SessionPullRequestIndicator } from "@/features/projects/session-pull-request-indicator";
import { SessionStatusIndicator } from "@/features/projects/session-status-indicator";

/** One session row: open-session navigation plus composed session actions. */
export function ProjectSessionRow({
  active,
  isActive,
  pullRequestLifecycle,
  session,
}: {
  readonly active: boolean;
  readonly isActive: () => boolean;
  readonly pullRequestLifecycle: PullRequestLifecycle | undefined;
  readonly session: SessionSummary;
}) {
  const navigate = useNavigate();

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
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
      >
        <SessionStatusIndicator phase={session.status?.phase} />
        <span className="truncate">{session.title ?? "New chat"}</span>
        <SessionPullRequestIndicator lifecycle={pullRequestLifecycle} />
      </SidebarMenuButton>
      <SessionActionsMenu isActive={isActive} session={session} />
    </SidebarMenuItem>
  );
}
