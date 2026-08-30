import type { Project } from "@getpie/contract";
import { useRouteContext } from "@tanstack/react-router";
import { useEffect } from "react";

import { isAbortError, sleep } from "@/lib/utils";

import {
  notifyRemovedProjects,
  projectCacheKeys,
  removeProjectFromCache,
} from "./project-list-cache";
import { applySessionListEvent } from "./session-list-cache";

const RESUBSCRIBE_DELAY_MS = 1000;

// The one always-on consumer of the global (firehose) subscription, called
// once from the root layout. It keeps Project and Session collections converged
// across tabs and the desktop app, not just the client that drove the change.
// Chunks and requests still belong to the per-session Chat transport.
export function useSessionListSync(onProjectDeleted: (projectId: string) => void): void {
  const { orpcClient, orpcQueryUtils, queryClient } = useRouteContext({ from: "__root__" });
  // The cleanup below does own every allocation, but the rule only recognizes
  // teardown it can name (`unsubscribe()`, `clearTimeout`, `socket.close`) and
  // can't follow an AbortController: aborting the signal cancels the in-flight
  // `subscribe`, terminates the `for await`, and settles a pending `sleep`.
  // react-doctor-disable-next-line effect-needs-cleanup
  useEffect(() => {
    const abort = new AbortController();
    const cacheKeys = projectCacheKeys(orpcQueryUtils);

    // The exact keys the sidebar's active/archived queries read. `queryOptions`
    // carries `type: "query"`, which the bare `.key({ input })` omits, so cache
    // writes must use these or they land in phantom entries nothing renders.
    const listKeyFor = cacheKeys.sessionList;
    const removeProject = (projectId: string) => {
      removeProjectFromCache(queryClient, cacheKeys, projectId);
      onProjectDeleted(projectId);
    };

    const run = async () => {
      while (!abort.signal.aborted) {
        const attempt = new AbortController();
        const abortAttempt = () => attempt.abort();
        abort.signal.addEventListener("abort", abortAttempt, { once: true });
        try {
          const stream = await orpcClient.agent.session.subscribe(
            { scope: { kind: "global" } },
            { signal: attempt.signal },
          );
          const previousProjects = queryClient.getQueryData<ReadonlyArray<Project>>(
            cacheKeys.projectList,
          );
          const currentProjects = await queryClient.fetchQuery(
            orpcQueryUtils.project.list.queryOptions(),
          );
          notifyRemovedProjects(previousProjects, currentProjects, removeProject);
          for await (const item of stream) {
            if (item.type !== "event") continue;
            if (item.event.type === "project.deleted") {
              const { projectId } = item.event;
              removeProject(projectId);
              continue;
            }
            applySessionListEvent(queryClient, listKeyFor, item.event);
          }
        } catch (error) {
          if (abort.signal.aborted || isAbortError(error)) return;
        } finally {
          attempt.abort();
          abort.signal.removeEventListener("abort", abortAttempt);
        }
        if (abort.signal.aborted) return;
        // The stream ended (server teardown / dropped connection): phase
        // transitions may have been missed, so the patched statuses can be
        // stale — refetch every list rather than trust them. Project collection
        // recovery happens only after the next subscription succeeds, so a
        // still-unavailable server cannot consume the one recovery attempt.
        void queryClient.invalidateQueries({ queryKey: orpcQueryUtils.agent.session.list.key() });
        // Back off, then re-subscribe. Resolves early on abort so unmount
        // doesn't wait out the delay.
        await sleep(RESUBSCRIBE_DELAY_MS, abort.signal);
      }
    };

    void run();
    return () => abort.abort();
  }, [onProjectDeleted, orpcClient, queryClient, orpcQueryUtils]);
}
