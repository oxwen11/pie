import type { SessionSummary } from "@getpie/contract";
import { SidebarMenuButton, SidebarMenuItem } from "@getpie/ui/components/sidebar";
import { useNavigate } from "@tanstack/react-router";

import { SessionActionsMenu } from "@/features/projects/session-actions-menu";
import { SessionStatusIndicator } from "@/features/projects/session-status-indicator";

/** One session row: open-session navigation plus composed session actions. */
export function ProjectSessionRow({
  active,
  isActive,
  session,
}: {
  readonly active: boolean;
  readonly isActive: () => boolean;
  readonly session: SessionSummary;
}) {
  const navigate = useNavigate();

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={active}
        onClick={() =>
          navigate({
            to: "/session/$sessionId",
            params: { sessionId: session.sessionId },
            search: { projectId: session.projectId },
          })
        }
      >
        <span className="truncate">{session.title ?? "New chat"}</span>
        {/* Busy elsewhere too: status is server-derived, so a turn any client
            is running shows here. */}
        <SessionStatusIndicator phase={session.status?.phase} />
      </SidebarMenuButton>
      <SessionActionsMenu isActive={isActive} session={session} />
    </SidebarMenuItem>
  );
}
