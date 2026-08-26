import type { SessionRef, SessionSummary } from "@getpie/contract";
import { useQuery } from "@tanstack/react-query";
import { useRouteContext } from "@tanstack/react-router";
import { useCallback } from "react";

import { sameSessionRef } from "@/lib/session-ref";

export const selectProjectSessionTitle = (
  sessions: ReadonlyArray<SessionSummary>,
  ref: SessionRef,
): string | null | undefined => {
  const session = sessions.find((candidate) => sameSessionRef(candidate, ref));
  return session === undefined ? undefined : (session.title ?? null);
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
    select,
  });
  const archived = useQuery({
    ...orpcQueryUtils.agent.session.list.queryOptions({
      input: { projectId: projectId ?? "", archived: true },
    }),
    enabled: enabled && active.isSuccess && active.data === undefined,
    select,
  });

  if (active.data !== undefined) return active.data ?? undefined;
  return archived.data ?? undefined;
}
