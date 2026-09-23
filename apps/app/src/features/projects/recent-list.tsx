import type { Project } from "@getpie/contract";
import { Collapsible, CollapsibleTrigger } from "@getpie/ui/components/collapsible";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
} from "@getpie/ui/components/sidebar";
import { useQueries } from "@tanstack/react-query";
import { useRouteContext } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";

import { KeepMountedCollapsiblePanel } from "@/features/projects/panel-motion";
import { ProjectSessionRow } from "@/features/projects/project-session-row";
import {
  useConnectedEnvironments,
  type ConnectedEnvironment,
} from "@/features/projects/use-connected-environments";
import { useProjectSessionRows } from "@/features/projects/use-project-session-rows";
import { useChatProjects } from "@/features/projects/use-projects";
import { EnvironmentOrpcProvider, useCatalogOrpc } from "@/lib/environment-orpc";

/** Chat projects (`type: "chat"`), listed as session rows — not under Projects. */
export function RecentList() {
  const { environmentRpc } = useRouteContext({ from: "__root__" });
  const environments = useConnectedEnvironments();
  const hasSessions = useHasRecentSessions(environments);
  const multi = environments.length > 1;
  if (!hasSessions) return null;

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
          <SidebarGroupContent className="flex flex-col gap-3">
            {environments.map((environment) => (
              <EnvironmentOrpcProvider
                key={environment.environmentId}
                orpc={environmentRpc.for(environment.environmentId)}
              >
                <EnvironmentRecent
                  environmentId={environment.environmentId}
                  label={multi ? environment.title : undefined}
                />
              </EnvironmentOrpcProvider>
            ))}
          </SidebarGroupContent>
        </KeepMountedCollapsiblePanel>
      </SidebarGroup>
    </Collapsible>
  );
}

/** Header hides until some connected Environment has a chat session. */
function useHasRecentSessions(environments: ReadonlyArray<ConnectedEnvironment>): boolean {
  const { environmentRpc } = useRouteContext({ from: "__root__" });
  const projects = useQueries({
    queries: environments.map((environment) =>
      environmentRpc.for(environment.environmentId).project.list.queryOptions(),
    ),
  });
  const chat = environments.flatMap((environment, index) =>
    (projects[index]?.data ?? [])
      .filter((project) => project.type === "chat")
      .map((project) => ({
        environmentId: environment.environmentId,
        projectId: project.id,
      })),
  );
  const sessions = useQueries({
    queries: chat.map((item) =>
      environmentRpc.for(item.environmentId).agent.session.list.queryOptions({
        input: { projectId: item.projectId, archived: false },
      }),
    ),
  });
  return sessions.some((list) => (list.data ?? []).length > 0);
}

function EnvironmentRecent({
  environmentId,
  label,
}: {
  readonly environmentId: string;
  readonly label?: string;
}) {
  const projects = useChatProjects().data ?? [];
  const orpc = useCatalogOrpc();
  // Same keys as the header check and useProjectSessionRows — cache-shared.
  const sessions = useQueries({
    queries: projects.map((project) =>
      orpc.agent.session.list.queryOptions({
        input: { projectId: project.id, archived: false },
      }),
    ),
  });
  if (sessions.every((list) => (list.data ?? []).length === 0)) return null;

  const rows = (
    <SidebarMenu>
      {projects.map((project) => (
        <RecentProjectSessions
          environmentId={environmentId}
          key={`${environmentId}:${project.id}`}
          project={project}
        />
      ))}
    </SidebarMenu>
  );
  if (label === undefined) return rows;
  return (
    <div className="flex flex-col gap-2">
      <div className="text-sidebar-foreground/60 px-2 text-xs tracking-wide uppercase">{label}</div>
      {rows}
    </div>
  );
}

function RecentProjectSessions({
  environmentId,
  project,
}: {
  readonly environmentId: string;
  readonly project: Project;
}) {
  const { createdBySchedule, isSessionActive, pullRequestFor, rows } = useProjectSessionRows(
    project,
    environmentId,
  );

  return (
    <>
      {rows.map((session) => {
        const active = isSessionActive(session);
        return (
          <ProjectSessionRow
            key={session.sessionId}
            active={active}
            createdBySchedule={createdBySchedule(session.sessionId)}
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
