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
        // The trailing action is hover-only on desktop (`showOnHover`); don't
        // keep the default pe-8 gap or long titles truncate into empty space.
        className="md:group-has-data-[sidebar=menu-action]/menu-item:pe-2"
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
        <span className="min-w-0 flex-1 truncate">{session.title ?? "New chat"}</span>
      </SidebarMenuButton>
      <SessionActionsMenu isActive={isActive} session={session} />
    </SidebarMenuItem>
  );
}
