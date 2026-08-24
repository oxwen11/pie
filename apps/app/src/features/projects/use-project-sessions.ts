import type { SessionPhase, SessionRef, SessionSummary } from "@getpie/contract";
import { useQuery } from "@tanstack/react-query";
import { useRouteContext } from "@tanstack/react-router";
import { useCallback } from "react";

import { sameSessionRef } from "@/lib/session-ref";

// Newest-first: a session is opened right after it is created. Module scope
// keeps `select` referentially stable across renders.
const selectNewestFirst = (
  sessions: ReadonlyArray<SessionSummary>,
): ReadonlyArray<SessionSummary> =>
  Array.from(sessions).sort((a, b) => b.createdAt.localeCompare(a.createdAt));

/**
 * The sessions under one project, newest-first.
 *
 * Held briefly, unlike `project.list`: this key has writers we don't drive —
 * the draft route seeds an optimistic row, `useSessionListSync` patches titles
 * in from `session.updated`.
 */
export function useProjectSessions(
  projectId: string,
  { archived = false, enabled = true }: { archived?: boolean; enabled?: boolean } = {},
) {
  const { orpcQueryUtils } = useRouteContext({ from: "__root__" });
  return useQuery({
    ...orpcQueryUtils.agent.session.list.queryOptions({ input: { projectId, archived } }),
    enabled,
    staleTime: 30_000,
    select: selectNewestFirst,
  });
}

export const selectProjectSessionTitle = (
  sessions: ReadonlyArray<SessionSummary>,
  ref: SessionRef,
): string | null | undefined => {
  const session = sessions.find((candidate) => sameSessionRef(candidate, ref));
  return session === undefined ? undefined : (session.title ?? null);
};

export const selectProjectSessionPhase = (
  sessions: ReadonlyArray<SessionSummary>,
  ref: SessionRef,
): SessionPhase | null | undefined => {
  const session = sessions.find((candidate) => sameSessionRef(candidate, ref));
  if (session === undefined) return undefined;
  return session.status?.phase ?? null;
};

/**
 * One session title from a project's held lists.
 *
 * The selector closes over the primitive SessionRef fields, so it stays
 * memoised: title events can patch the shared list while this consumer
 * re-renders only for its own title.
 * The archived list stays cold unless the active list has loaded without the
 * routed session; this preserves archived bookmarks without doubling the usual
 * session-page request.
 */
export function useProjectSessionTitle(ref: SessionRef | undefined): string | undefined {
  const { orpcQueryUtils } = useRouteContext({ from: "__root__" });
  const projectId = ref?.projectId;
  const sessionId = ref?.sessionId;
  const enabled = projectId !== undefined && sessionId !== undefined;
  const select = useCallback(
    (sessions: ReadonlyArray<SessionSummary>) =>
      projectId === undefined || sessionId === undefined
        ? undefined
        : selectProjectSessionTitle(sessions, { projectId, sessionId }),
    [projectId, sessionId],
  );
  const active = useQuery({
    ...orpcQueryUtils.agent.session.list.queryOptions({
      input: { projectId: projectId ?? "", archived: false },
    }),
    enabled,
    staleTime: 30_000,
    select,
  });
  const archived = useQuery({
    ...orpcQueryUtils.agent.session.list.queryOptions({
      input: { projectId: projectId ?? "", archived: true },
    }),
    enabled: enabled && active.isSuccess && active.data === undefined,
    staleTime: 30_000,
    select,
  });

  if (active.data !== undefined) return active.data ?? undefined;
  return archived.data ?? undefined;
}

/**
 * One session runtime phase from a project's held lists.
 *
 * Same cache seam as `useProjectSessionTitle`: server events patch
 * `SessionSummary.status` in the shared list, so the header can reflect
 * background turns without opening the transcript.
 */
export function useProjectSessionPhase(ref: SessionRef | undefined): SessionPhase | undefined {
  const { orpcQueryUtils } = useRouteContext({ from: "__root__" });
  const projectId = ref?.projectId;
  const sessionId = ref?.sessionId;
  const enabled = projectId !== undefined && sessionId !== undefined;
  const select = useCallback(
    (sessions: ReadonlyArray<SessionSummary>) =>
      projectId === undefined || sessionId === undefined
        ? undefined
        : selectProjectSessionPhase(sessions, { projectId, sessionId }),
    [projectId, sessionId],
  );
  const active = useQuery({
    ...orpcQueryUtils.agent.session.list.queryOptions({
      input: { projectId: projectId ?? "", archived: false },
    }),
    enabled,
    staleTime: 30_000,
    select,
  });
  const archived = useQuery({
    ...orpcQueryUtils.agent.session.list.queryOptions({
      input: { projectId: projectId ?? "", archived: true },
    }),
    enabled: enabled && active.isSuccess && active.data === undefined,
    staleTime: 30_000,
    select,
  });

  if (active.data !== undefined) return active.data ?? undefined;
  return archived.data ?? undefined;
}
