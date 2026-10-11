import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { useCatalogOrpc } from "@/lib/environment-orpc";
import { isAbortError, sleep } from "@/lib/utils";

import { applySessionListEvent } from "./session-list-cache";

const RESUBSCRIBE_DELAY_MS = 1000;

// ponytail: second global subscribe beside environment-list-sync, so demand can
// reconnect when the stream drops. Fold into that worker if the extra stream matters.
export function useSessionListSync(
  onSubscribed?: () => void,
  onCollectionEvent?: (type: string) => void,
): void {
  const orpc = useCatalogOrpc();
  const queryClient = useQueryClient();
  useEffect(() => {
    const abort = new AbortController();
    const listKeyFor = (projectId: string, archived: boolean) =>
      orpc.session.ls.queryOptions({ input: { projectId, archived } }).queryKey;

    const run = async () => {
      while (!abort.signal.aborted) {
        try {
          const stream = await orpc.session.subscribe.call(
            { scope: { kind: "global" } },
            { signal: abort.signal },
          );
          onSubscribed?.();
          await queryClient.invalidateQueries({
            queryKey: orpc.session.ls.key(),
          });
          for await (const item of stream) {
            if (item.type !== "event") continue;
            applySessionListEvent(queryClient, listKeyFor, item.event);
            onCollectionEvent?.(item.event.type);
          }
        } catch (error) {
          if (abort.signal.aborted || isAbortError(error)) return;
        }
        if (abort.signal.aborted) return;
        await sleep(RESUBSCRIBE_DELAY_MS, abort.signal);
      }
    };

    void run();
    return () => abort.abort();
  }, [orpc, queryClient, onSubscribed, onCollectionEvent]);
}
