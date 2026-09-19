import type { Project } from "@getpie/contract";
import {
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
} from "@getpie/ui/components/collapsible";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
} from "@getpie/ui/components/sidebar";
import { ChevronRight } from "lucide-react";

import { COLLAPSIBLE_PANEL_MOTION } from "@/features/projects/panel-motion";
import { ProjectSessionRow } from "@/features/projects/project-session-row";
import { useProjectSessionRows } from "@/features/projects/use-project-session-rows";
import { useChatProjects } from "@/features/projects/use-projects";

/** Chat projects (`type: "chat"`), listed as session rows — not under Projects. */
export function RecentList() {
  const chatProjects = useChatProjects();
  const projects = chatProjects.data ?? [];
  if (projects.length === 0) return null;

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
        <CollapsiblePanel className={COLLAPSIBLE_PANEL_MOTION} keepMounted>
          <SidebarGroupContent>
            <SidebarMenu>
              {projects.map((project) => (
                <RecentProjectSessions key={project.id} project={project} />
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </CollapsiblePanel>
      </SidebarGroup>
    </Collapsible>
  );
}

function RecentProjectSessions({ project }: { readonly project: Project }) {
  const { createdBySchedule, isSessionActive, pullRequestFor, rows } =
    useProjectSessionRows(project);

  return (
    <>
      {rows.map((session) => {
        const active = isSessionActive(session);
        return (
          <ProjectSessionRow
            key={session.sessionId}
            active={active}
            createdBySchedule={createdBySchedule(session.sessionId)}
            isActive={() => isSessionActive(session)}
            pullRequest={pullRequestFor(session, active)}
            session={session}
          />
        );
      })}
    </>
  );
}
