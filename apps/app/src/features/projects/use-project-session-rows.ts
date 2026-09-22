import type { Project, SessionRef, SessionSummary } from "@getpie/contract";
import type { PullRequestSessionStatus, PullRequestSnapshot } from "@getpie/contract/pull-request";
import { keepPreviousData, skipToken, useQuery } from "@tanstack/react-query";
import { useRouteContext, useRouter } from "@tanstack/react-router";

import type { SessionPullRequest } from "@/features/projects/project-session-row";
import { useCatalogOrpc } from "@/lib/environment-orpc";
import { sameSessionRef, sessionRefFromRouterMatches } from "@/lib/session-ref";

const EMPTY_SESSIONS: ReadonlyArray<SessionSummary> = [];
const EMPTY_PULL_REQUEST_STATUSES = new Map<string, SessionPullRequest>();

const selectPullRequestStatuses = (
  statuses: ReadonlyArray<PullRequestSessionStatus>,
): ReadonlyMap<string, SessionPullRequest> =>
  new Map(
    statuses.map((status) => [
      status.ref.sessionId,
      { lifecycle: status.lifecycle, url: status.url },
    ]),
  );

const selectPullRequest = (snapshot: PullRequestSnapshot | null): SessionPullRequest | null =>
  snapshot === null ? null : { lifecycle: snapshot.lifecycle, url: snapshot.url };

const selectNewestFirst = (
  sessions: ReadonlyArray<SessionSummary>,
): ReadonlyArray<SessionSummary> =>
  Array.from(sessions).sort((a, b) => b.createdAt.localeCompare(a.createdAt));

/** Session rows + PR/schedule adornments for one project's sidebar list. */
export function useProjectSessionRows(project: Project) {
  const { localEnvironmentId } = useRouteContext({ from: "__root__" });
  const orpcQueryUtils = useCatalogOrpc();
  const router = useRouter();
  const isSessionActive = (ref: SessionRef) =>
    sameSessionRef(
      { environmentId: localEnvironmentId, ref },
      sessionRefFromRouterMatches(router.state.matches),
    );
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
    select: selectPullRequest,
  });
  const statusBySessionId = pullRequestStatuses.data ?? EMPTY_PULL_REQUEST_STATUSES;

  return {
    environmentId: localEnvironmentId,
    isSessionActive,
    rows,
    pullRequestFor: (session: SessionSummary, active: boolean) => {
      const listed = statusBySessionId.get(session.sessionId);
      const value = active ? (activePullRequest.data ?? listed) : listed;
      return value ?? undefined;
    },
  };
}
