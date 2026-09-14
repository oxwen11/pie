import type { QueryClient, QueryKey } from "@tanstack/react-query";

/** Coalesce notifications, but never let an already-running read swallow a newer event. */
export function createQueryRepair(queryClient: QueryClient, queryKey: QueryKey): () => void {
  let pending = false;
  let running = false;
  return () => {
    pending = true;
    if (running) return;
    running = true;
    const repair = async () => {
      try {
        while (pending) {
          pending = false;
          // Waiting first matters: invalidateQueries can otherwise reuse an old
          // request whose response was captured before this notification.
          await Promise.allSettled(
            queryClient
              .getQueryCache()
              .findAll({ queryKey })
              .flatMap((query) => (query.promise ? [query.promise] : [])),
          );
          await queryClient.invalidateQueries({ queryKey }, { cancelRefetch: false });
        }
      } finally {
        running = false;
      }
    };
    void repair();
  };
}
