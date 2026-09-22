import type { Project } from "@getpie/contract";
import { Collapsible, CollapsibleTrigger } from "@getpie/ui/components/collapsible";
import {
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
} from "@getpie/ui/components/sidebar";
import { Link } from "@tanstack/react-router";
import { Folder, FolderOpen, SquarePen } from "lucide-react";

import { KeepMountedCollapsiblePanel } from "@/features/projects/panel-motion";
import { ProjectSessionRow } from "@/features/projects/project-session-row";
import { useProjectSessionRows } from "@/features/projects/use-project-session-rows";

/**
 * One project and the sessions under it, as a collapsible sidebar group. The
 * label is its own collapse trigger; a Folder icon swaps to FolderOpen when the
 * panel is open (two icon entities, not a rotation). This component owns only
 * grouping and fetching; each row composes its own navigation and actions.
 */
export function ProjectSessionsGroup({ project }: { readonly project: Project }) {
  const { createdBySchedule, isSessionActive, pullRequestFor, rows } =
    useProjectSessionRows(project);

  return (
    <Collapsible defaultOpen>
      <section className="relative min-w-0" aria-labelledby={`project-${project.id}`}>
        {/* pe-8 keeps a long name off the absolutely positioned action; w-full is what
            makes it and `truncate` bite, since the label renders as a shrink-to-fit <button>. */}
        <SidebarGroupLabel
          className="text-sidebar-accent-foreground h-7 w-full min-w-0 pe-8 text-sm"
          id={`project-${project.id}`}
          title={project.path}
          render={
            <CollapsibleTrigger className="group/project hover:bg-sidebar-accent/70 cursor-pointer gap-1.5" />
          }
        >
          {/* Folder closed → FolderOpen when the panel expands. */}
          <Folder className="size-4 shrink-0 group-data-[panel-open]/project:hidden" />
          <FolderOpen className="hidden size-4 shrink-0 group-data-[panel-open]/project:block" />
          <span className="truncate">{project.name}</span>
        </SidebarGroupLabel>
        <SidebarGroupAction
          className="top-1 right-1"
          render={<Link to="/draft" search={{ projectId: project.id }} />}
          title={`New chat in ${project.name}`}
        >
          <SquarePen />
          {/* Names the button per project: element content wins over `title` in the accessible-name computation, so a bare "New chat" would make every project's action announce identically. */}
          <span className="sr-only">New chat in {project.name}</span>
        </SidebarGroupAction>
        {/* keepMounted: see panel-motion.tsx — an unmounting panel makes every
            expand rebuild this project's whole session list. */}
        <KeepMountedCollapsiblePanel>
          <SidebarGroupContent>
            <SidebarMenu>
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
            </SidebarMenu>
          </SidebarGroupContent>
        </KeepMountedCollapsiblePanel>
      </section>
    </Collapsible>
  );
}
