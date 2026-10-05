import type { Project } from "@getpie/contract";
import { Collapsible, CollapsibleTrigger } from "@getpie/ui/components/collapsible";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
} from "@getpie/ui/components/sidebar";
import { useQueries } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";

import { KeepMountedCollapsiblePanel } from "@/features/projects/panel-motion";
import { ProjectSessionRow } from "@/features/projects/project-session-row";
import { useProjectSessionRows } from "@/features/projects/use-project-session-rows";
import { useChatProjects } from "@/features/projects/use-projects";
import { useCatalogOrpc } from "@/lib/environment-orpc";

/** Chat projects (`type: "chat"`), listed as session rows — not under Projects. */
export function RecentList() {
  const chatProjects = useChatProjects();
  const projects = chatProjects.data ?? [];
  const orpcQueryUtils = useCatalogOrpc();
  // Same query keys as useProjectSessionRows below — cache-shared, so this only
  // subscribes; it exists so the header can hide when every chat project is empty.
  const sessions = useQueries({
    queries: projects.map((project) =>
      orpcQueryUtils.agent.session.list.queryOptions({
        input: { projectId: project.id, archived: false },
      }),
    ),
  });
  if (sessions.every((list) => (list.data ?? []).length === 0)) return null;

  return (
    <Collapsible defaultOpen>
      <SidebarGroup>
        <SidebarGroupLabel
          className="text-sidebar-foreground/70 tracking-wider"
          render={
            <CollapsibleTrigger className="group/recent-trigger hover:bg-sidebar-accent/70 cursor-pointer gap-1.5 pe-8" />
          }
        >
          <span>Recent</span>
          <ChevronRight className="transition-transform group-data-[panel-open]/recent-trigger:rotate-90" />
        </SidebarGroupLabel>
        <KeepMountedCollapsiblePanel>
          <SidebarGroupContent>
            <SidebarMenu>
              {projects.map((project) => (
                <RecentProjectSessions key={project.id} project={project} />
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </KeepMountedCollapsiblePanel>
      </SidebarGroup>
    </Collapsible>
  );
}

function RecentProjectSessions({ project }: { readonly project: Project }) {
  const { environmentId, isSessionActive, pullRequestFor, rows } = useProjectSessionRows(project);

  return (
    <>
      {rows.map((session) => {
        const active = isSessionActive(session);
        return (
          <ProjectSessionRow
            key={session.sessionId}
            active={active}
            environmentId={environmentId}
            isActive={() => isSessionActive(session)}
            pullRequest={pullRequestFor(session, active)}
            session={session}
          />
        );
      })}
    </>
  );
}
