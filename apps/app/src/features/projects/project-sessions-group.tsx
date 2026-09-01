import type { Project, SessionRef, SessionSummary } from "@getpie/contract";
import type {
  PullRequestLifecycle,
  PullRequestSessionStatus,
  PullRequestSnapshot,
} from "@getpie/contract/pull-request";
import {
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
} from "@getpie/ui/components/collapsible";
import {
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
} from "@getpie/ui/components/sidebar";
import { keepPreviousData, skipToken, useQuery } from "@tanstack/react-query";
import { useNavigate, useRouteContext } from "@tanstack/react-router";
import { Folder, FolderOpen, SquarePen } from "lucide-react";
import { useState } from "react";

import { COLLAPSIBLE_PANEL_MOTION } from "@/features/projects/panel-motion";
import { ProjectSessionRow } from "@/features/projects/project-session-row";
import {
  rememberPullRequestLifecycle,
  rememberPullRequestLifecycles,
} from "@/features/projects/remember-pull-request-lifecycles";

const EMPTY_SESSIONS: ReadonlyArray<SessionSummary> = [];
const EMPTY_PULL_REQUEST_STATUSES = new Map<string, PullRequestLifecycle>();

const selectPullRequestStatuses = (
  statuses: ReadonlyArray<PullRequestSessionStatus>,
): ReadonlyMap<string, PullRequestLifecycle> =>
  new Map(statuses.map((status) => [status.ref.sessionId, status.lifecycle]));

const selectPullRequestLifecycle = (
  snapshot: PullRequestSnapshot | null,
): PullRequestLifecycle | null => snapshot?.lifecycle ?? null;

// Newest-first: a session is opened right after it is created. Module scope
// keeps `select` referentially stable across renders.
const selectNewestFirst = (
  sessions: ReadonlyArray<SessionSummary>,
): ReadonlyArray<SessionSummary> =>
  Array.from(sessions).sort((a, b) => b.createdAt.localeCompare(a.createdAt));

/**
 * One project and the sessions under it, as a collapsible sidebar group. The
 * label is its own collapse trigger; a Folder icon swaps to FolderOpen when the
 * panel is open (two icon entities, not a rotation). This component owns only
 * grouping and fetching; each row composes its own navigation and actions.
 */
export function ProjectSessionsGroup({
  isSessionActive,
  project,
}: {
  readonly isSessionActive: (ref: SessionRef) => boolean;
  readonly project: Project;
}) {
  const navigate = useNavigate();
  const { orpcQueryUtils } = useRouteContext({ from: "__root__" });
  const sessions = useQuery({
    ...orpcQueryUtils.agent.session.list.queryOptions({
      input: { projectId: project.id, archived: false },
    }),
    select: selectNewestFirst,
  });
  const rows = sessions.data ?? EMPTY_SESSIONS;
  const refs = rows.map(({ projectId, sessionId }) => ({ projectId, sessionId }));
  const pullRequestStatuses = useQuery({
    ...orpcQueryUtils.pullRequest.statuses.queryOptions({ input: { refs } }),
    enabled: refs.length > 0,
    placeholderData: keepPreviousData,
    select: selectPullRequestStatuses,
  });
  const activeSession = rows.find(isSessionActive);
  const activePullRequest = useQuery({
    ...orpcQueryUtils.pullRequest.current.queryOptions({
      input: activeSession === undefined ? skipToken : { ref: activeSession },
    }),
    select: selectPullRequestLifecycle,
  });
  const [remembered, setRemembered] = useState(EMPTY_PULL_REQUEST_STATUSES);
  const statusBySessionId = rememberPullRequestLifecycle(
    rememberPullRequestLifecycles(remembered, pullRequestStatuses.data),
    activeSession?.sessionId,
    activePullRequest.data,
  );
  if (statusBySessionId !== remembered) setRemembered(statusBySessionId);

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
          onClick={() => {
            navigate({ to: "/draft", search: { projectId: project.id } }).catch(
              (error: unknown) => {
                console.error("Failed to start a draft chat", error);
              },
            );
          }}
          title={`New chat in ${project.name}`}
        >
          <SquarePen />
          {/* Names the button per project: element content wins over `title` in the accessible-name computation, so a bare "New chat" would make every project's action announce identically. */}
          <span className="sr-only">New chat in {project.name}</span>
        </SidebarGroupAction>
        {/* keepMounted: see panel-motion.ts — an unmounting panel makes every
            expand rebuild this project's whole session list. */}
        <CollapsiblePanel className={COLLAPSIBLE_PANEL_MOTION} keepMounted>
          <SidebarGroupContent>
            <SidebarMenu>
              {rows.map((session) => {
                const active = isSessionActive(session);
                return (
                  <ProjectSessionRow
                    key={session.sessionId}
                    active={active}
                    isActive={() => isSessionActive(session)}
                    pullRequestLifecycle={statusBySessionId.get(session.sessionId)}
                    session={session}
                  />
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </CollapsiblePanel>
      </section>
    </Collapsible>
  );
}
