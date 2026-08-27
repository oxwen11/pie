import type { SessionSummary } from "@getpie/contract";
import { SidebarMenuButton, SidebarMenuItem } from "@getpie/ui/components/sidebar";
import { useNavigate } from "@tanstack/react-router";
import { Clock } from "lucide-react";

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
        {session.scheduleId !== undefined ? (
          <Clock
            aria-hidden
            className="text-muted-foreground size-3.5 shrink-0 opacity-70"
            title="Created by a schedule"
          />
        ) : null}
      </SidebarMenuButton>
      <SessionActionsMenu isActive={isActive} session={session} />
    </SidebarMenuItem>
  );
}
