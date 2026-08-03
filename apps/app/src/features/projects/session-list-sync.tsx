import type { QueryClient } from "@tanstack/react-query";
import type { VibestClient } from "@vibest/client";
import type { CollectionEvent, ListSessionsOutput, SessionScopedEvent } from "@vibest/contract";
import { isSessionScopedEvent } from "@vibest/contract";
import { useEffect } from "react";

import type { AppClients } from "@/lib/orpc";

const RESUBSCRIBE_DELAY_MS = 1000;

const isAbortError = (error: unknown) =>
  error instanceof DOMException && error.name === "AbortError";

// The one always-mounted consumer of the global (firehose) subscription's
// collection events. It keeps every open `session.list` cache converged —
// across tabs and the desktop app, not just the tab that drove the change —
// by patching the affected row in place. Of the session-scoped events, only
// the coarse turn lifecycle is consumed — it drives the sidebar's busy
// indicator for sessions this client never opened; chunks and requests still
// belong to the per-session Chat transport.
export function SessionListSync({
  client,
  queryClient,
  orpcQueryUtils,
}: {
  readonly client: VibestClient;
  readonly queryClient: QueryClient;
  readonly orpcQueryUtils: AppClients["orpcQueryUtils"];
}): null {
  // The cleanup below does own every allocation, but the rule only recognizes
  // teardown it can name (`unsubscribe()`, `clearTimeout`, `socket.close`) and
  // can't follow an AbortController: aborting the signal cancels the in-flight
  // `subscribe` and terminates the `for await`, and the timer is cleared too.
  // react-doctor-disable-next-line effect-needs-cleanup
  useEffect(() => {
    const abort = new AbortController();
    // Tracked so cleanup owns every allocation: aborting mid-backoff must clear
    // the pending timer, not leave it to fire into an unmounted component.
    let backoff: ReturnType<typeof setTimeout> | undefined;

    // The exact key the sidebar's `session.list` query reads — the `queryOptions`
    // key carries `type: "query"`, which the bare `.key({ input })` omits, so
    // setQueryData must use this or it writes a phantom entry nothing renders.
    const listKeyFor = (projectId: string) =>
      orpcQueryUtils.session.list.queryOptions({ input: { projectId } }).queryKey;

    const apply = (event: CollectionEvent) => {
      const listKey = listKeyFor(event.ref.projectId);
      switch (event.type) {
        case "session.updated": {
          // Merge the new title into the existing row, preserving an optimistic
          // one's live status/createdAt. A row we don't hold yet (another client
          // created this session) → pull the authoritative list once; the read is
          // a cheap pure-storage query.
          let patched = false;
          queryClient.setQueryData<ListSessionsOutput>(listKey, (prev) => {
            if (!prev) return prev;
            const index = prev.findIndex((s) => s.sessionId === event.ref.sessionId);
            const row = index === -1 ? undefined : prev[index];
            if (!row) return prev;
            patched = true;
            const next = prev.slice();
            next[index] = {
              ...row,
              ...(event.title !== undefined ? { title: event.title } : {}),
            };
            return next;
          });
          if (!patched) void queryClient.invalidateQueries({ queryKey: listKey });
          break;
        }
        case "session.renamed": {
          queryClient.setQueryData<ListSessionsOutput>(listKey, (prev) =>
            prev?.map((s) =>
              s.sessionId === event.ref.sessionId ? { ...s, title: event.name } : s,
            ),
          );
          break;
        }
        case "session.deleted": {
          queryClient.setQueryData<ListSessionsOutput>(listKey, (prev) =>
            prev?.filter((s) => s.sessionId !== event.ref.sessionId),
          );
          break;
        }
        case "session.created":
          // The creating tab already seeded this row optimistically; a title-less
          // row elsewhere has nothing to show yet. Other clients pick the session
          // up on its first prompt's `session.updated`, or their next list load.
          break;
      }
    };

    // The runtime stamps its post-event phase onto every session-scoped event,
    // so the sidebar copies it rather than re-deriving from event types. Chunk
    // events are skipped for traffic (their phase never differs from the
    // lifecycle event that opened the turn), and an unchanged phase returns
    // the previous cache object so subscribers don't re-render per event. A
    // phase for a row we don't hold is dropped — the next list load carries
    // its status.
    const applyScoped = (event: SessionScopedEvent) => {
      const phase = event.phase;
      if (phase === undefined || event.type === "session.message.chunk") return;
      queryClient.setQueryData<ListSessionsOutput>(listKeyFor(event.ref.projectId), (prev) => {
        if (!prev) return prev;
        const row = prev.find((s) => s.sessionId === event.ref.sessionId);
        if (!row || row.status?.phase === phase) return prev;
        return prev.map((s) => (s === row ? { ...s, status: { phase } } : s));
      });
    };

    const run = async () => {
      while (!abort.signal.aborted) {
        try {
          const stream = await client.session.subscribe(
            { scope: { kind: "global" } },
            { signal: abort.signal },
          );
          for await (const item of stream) {
            if (item.type !== "event") continue;
            if (isSessionScopedEvent(item.event)) applyScoped(item.event);
            else apply(item.event);
          }
        } catch (error) {
          if (abort.signal.aborted || isAbortError(error)) return;
        }
        if (abort.signal.aborted) return;
        // The stream ended (server teardown / dropped connection): phase
        // transitions may have been missed, so the patched statuses can be
        // stale — refetch every list rather than trust them.
        void queryClient.invalidateQueries({ queryKey: orpcQueryUtils.session.list.key() });
        // Back off, then re-subscribe. Resolves early on abort so unmount
        // doesn't wait out the delay.
        await new Promise<void>((resolve) => {
          backoff = setTimeout(resolve, RESUBSCRIBE_DELAY_MS);
          abort.signal.addEventListener("abort", () => resolve(), { once: true });
        });
      }
    };

    void run();
    return () => {
      abort.abort();
      clearTimeout(backoff);
    };
  }, [client, queryClient, orpcQueryUtils]);

  return null;
}
