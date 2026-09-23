import type { Project, SessionRef, SessionSummary } from "@getpie/contract";
import { collectFiredSessionIds } from "@getpie/contract";
import type { PullRequestSessionStatus } from "@getpie/contract/pull-request";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";

import { useCatalogOrpc } from "@/lib/environment-orpc";
import { sameSessionRef, sessionRefFromRouterMatches } from "@/lib/session-ref";

const EMPTY_SESSIONS: ReadonlyArray<SessionSummary> = [];
const EMPTY_PULL_REQUEST_STATUSES = new Map<string, PullRequestSessionStatus>();

const selectPullRequestStatuses = (
  statuses: ReadonlyArray<PullRequestSessionStatus>,
): ReadonlyMap<string, PullRequestSessionStatus> =>
  new Map(statuses.map((status) => [status.ref.sessionId, status]));

const selectNewestFirst = (
  sessions: ReadonlyArray<SessionSummary>,
): ReadonlyArray<SessionSummary> =>
  Array.from(sessions).sort((a, b) => b.createdAt.localeCompare(a.createdAt));

/** Session rows + PR/schedule adornments for one project's sidebar list. */
export function useProjectSessionRows(project: Project, environmentId: string) {
  const orpcQueryUtils = useCatalogOrpc();
  const router = useRouter();
  const isSessionActive = (ref: SessionRef) =>
    sameSessionRef({ environmentId, ref }, sessionRefFromRouterMatches(router.state.matches));
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
  const statusBySessionId = pullRequestStatuses.data ?? EMPTY_PULL_REQUEST_STATUSES;
  const firedSessionIds = useQuery({
    ...orpcQueryUtils.schedule.list.queryOptions(),
    select: collectFiredSessionIds,
    refetchInterval: 10_000,
  });

  return {
    isSessionActive,
    rows,
    pullRequestFor: (session: SessionSummary, _active: boolean) =>
      statusBySessionId.get(session.sessionId),
    createdBySchedule: (sessionId: string) => firedSessionIds.data?.has(sessionId) === true,
  };
}
