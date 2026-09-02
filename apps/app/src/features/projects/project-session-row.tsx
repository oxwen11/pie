import type { Automation, SessionSummary } from "@getpie/contract";
import { SidebarMenuButton, SidebarMenuItem } from "@getpie/ui/components/sidebar";
import { useQuery } from "@tanstack/react-query";
import { Link, useRouteContext, useRouter } from "@tanstack/react-router";
import { Clock } from "lucide-react";
import { useCallback } from "react";

import { collectFiredSessionIds } from "@/features/projects/fired-session-ids";
import { SessionActionsMenu } from "@/features/projects/session-actions-menu";
import { SessionStatusIndicator } from "@/features/projects/session-status-indicator";
import { sameSessionRef, sessionRefFromRouterMatches } from "@/lib/session-ref";

/** One session row: open-session navigation plus composed session actions. */
export function ProjectSessionRow({ session }: { readonly session: SessionSummary }) {
  const router = useRouter();
  const { orpcQueryUtils } = useRouteContext({ from: "__root__" });
  // Closes over this row's sessionId so only a boolean change re-renders.
  const selectCreatedByAutomation = useCallback(
    (automations: ReadonlyArray<Automation>) =>
      collectFiredSessionIds(automations).has(session.sessionId),
    [session.sessionId],
  );
  const createdByAutomation = useQuery({
    ...orpcQueryUtils.automation.list.queryOptions(),
    select: selectCreatedByAutomation,
    refetchInterval: 10_000,
  });
  const active = sameSessionRef(session, sessionRefFromRouterMatches(router.state.matches));

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={active}
        render={
          <Link
            params={{ sessionId: session.sessionId }}
            search={{ projectId: session.projectId }}
            to="/session/$sessionId"
          />
        }
      >
        <SessionStatusIndicator phase={session.status?.phase} />
        <span className="truncate">{session.title ?? "New chat"}</span>
        {createdByAutomation.data === true ? (
          <span
            className="text-muted-foreground inline-flex shrink-0"
            title="Created by a schedule"
          >
            <Clock aria-hidden className="size-3.5 opacity-70" />
          </span>
        ) : null}
      </SidebarMenuButton>
      <SessionActionsMenu session={session} />
    </SidebarMenuItem>
  );
}
