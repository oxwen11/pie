import { useRouteContext } from "@tanstack/react-router";
import { useEffect } from "react";

import { isAbortError, sleep } from "@/lib/utils";

import { applySessionListEvent } from "./session-list-cache";

const RESUBSCRIBE_DELAY_MS = 1000;

// The one always-on consumer of the global subscription, called once from the
// root layout. Each connection opens the stream before refreshing the lists,
// so events arriving during that refresh wait in the stream instead of falling
// into an uncovered reconnect gap.
export function useSessionListSync(): void {
  const { orpcClient, orpcQueryUtils, queryClient } = useRouteContext({ from: "__root__" });
  // The cleanup below does own every allocation, but the rule only recognizes
  // teardown it can name (`unsubscribe()`, `clearTimeout`, `socket.close`) and
  // can't follow an AbortController: aborting the signal cancels the in-flight
  // `subscribe`, terminates the `for await`, and settles a pending `sleep`.
  // react-doctor-disable-next-line effect-needs-cleanup
  useEffect(() => {
    const abort = new AbortController();

    // The exact keys the sidebar's active/archived queries read. `queryOptions`
    // carries `type: "query"`, which the bare `.key({ input })` omits, so cache
    // writes must use these or they land in phantom entries nothing renders.
    const listKeyFor = (projectId: string, archived: boolean) =>
      orpcQueryUtils.agent.session.list.queryOptions({ input: { projectId, archived } }).queryKey;

    const run = async () => {
      while (!abort.signal.aborted) {
        try {
          const stream = await orpcClient.agent.session.subscribe(
            { scope: { kind: "global" } },
            { signal: abort.signal },
          );
          // The stream is already registered server-side. Refresh the
          // authoritative baseline now; events that race the read remain
          // buffered and apply afterward.
          await queryClient.invalidateQueries({
            queryKey: orpcQueryUtils.agent.session.list.key(),
          });
          for await (const item of stream) {
            if (item.type !== "event") continue;
            applySessionListEvent(queryClient, listKeyFor, item.event);
          }
        } catch (error) {
          if (abort.signal.aborted || isAbortError(error)) return;
        }
        if (abort.signal.aborted) return;
        // Back off, then repeat the same subscribe-first baseline sequence.
        // Resolves early on abort so unmount doesn't wait out the delay.
        await sleep(RESUBSCRIBE_DELAY_MS, abort.signal);
      }
    };

    void run();
    return () => abort.abort();
  }, [orpcClient, queryClient, orpcQueryUtils]);
}
