import type { ServerEvent } from "@getpie/contract";
import { isSessionScopedEvent } from "@getpie/contract/session-events";
import type { QueryClient, QueryKey } from "@tanstack/react-query";

export type ListKeyFor = (projectId: string, archived: boolean) => QueryKey;

/**
 * Treat the global stream as an invalidation channel. `session.list` is the
 * single source of truth for both persisted metadata and its live-status
 * overlay; transcript chunks are the only events that cannot change a row.
 */
export const applySessionListEvent = (
  queryClient: QueryClient,
  listKeyFor: ListKeyFor,
  event: ServerEvent,
): void => {
  if (isSessionScopedEvent(event) && event.type === "session.message.chunk") return;
  for (const archived of [false, true]) {
    void queryClient.invalidateQueries({
      queryKey: listKeyFor(event.ref.projectId, archived),
    });
  }
};
