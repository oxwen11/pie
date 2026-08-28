import type { SessionSummary } from "@getpie/contract";
import { SidebarMenuButton, SidebarMenuItem } from "@getpie/ui/components/sidebar";
import { useNavigate } from "@tanstack/react-router";
import { Clock } from "lucide-react";

import { SessionActionsMenu } from "@/features/projects/session-actions-menu";
import { SessionStatusIndicator } from "@/features/projects/session-status-indicator";

/** One session row: open-session navigation plus composed session actions. */
export function ProjectSessionRow({
  active,
  createdByAutomation,
  isActive,
  session,
}: {
  readonly active: boolean;
  readonly createdByAutomation: boolean;
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
        {createdByAutomation ? (
          <span
            className="text-muted-foreground inline-flex shrink-0"
            title="Created by an automation"
          >
            <Clock aria-hidden className="size-3.5 opacity-70" />
          </span>
        ) : null}
      </SidebarMenuButton>
      <SessionActionsMenu isActive={isActive} session={session} />
    </SidebarMenuItem>
  );
}
