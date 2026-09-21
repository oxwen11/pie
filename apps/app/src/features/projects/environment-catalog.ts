import type { Project } from "@getpie/contract";

import type { EnvironmentRpc } from "@/lib/environment-rpc";
import { sleep } from "@/lib/utils";

import { applySessionListEvent } from "./session-list-cache";

const RESUBSCRIBE_DELAY_MS = 1000;

export type EnvironmentCatalog = {
  start(environmentId: string): void;
  stop(environmentId: string): void;
  dispose(): void;
};

/**
 * Keeps every connected daemon's project/session catalog warm and converged,
 * independent of which Environment the React tree currently renders.
 */
export function createEnvironmentCatalog(environmentRpc: EnvironmentRpc): EnvironmentCatalog {
  const workers = new Map<string, AbortController>();

  const start = (environmentId: string): void => {
    if (workers.has(environmentId)) return;
    const orpc = environmentRpc.for(environmentId);
    const abort = new AbortController();
    workers.set(environmentId, abort);

    const listKeyFor = (projectId: string, archived: boolean) =>
      orpc.agent.session.list.queryOptions({ input: { projectId, archived } }).queryKey;

    const hydrate = async (): Promise<void> => {
      const projects = await environmentRpc.queryClient.query({
        ...orpc.project.list.queryOptions(),
        staleTime: 0,
      });
      await Promise.all(
        projects.map((project: Project) =>
          environmentRpc.queryClient.query({
            ...orpc.agent.session.list.queryOptions({
              input: { projectId: project.id, archived: false },
            }),
            staleTime: 0,
          }),
        ),
      );
    };

    const run = async (): Promise<void> => {
      while (!abort.signal.aborted) {
        const attempt = new AbortController();
        const abortAttempt = () => attempt.abort();
        abort.signal.addEventListener("abort", abortAttempt, { once: true });
        try {
          // Subscribe before the baseline fetch so events racing hydration stay buffered.
          const stream = await orpc.agent.session.subscribe.call(
            { scope: { kind: "global" } },
            { signal: attempt.signal },
          );
          await hydrate();
          for await (const item of stream) {
            if (item.type !== "event") continue;
            applySessionListEvent(environmentRpc.queryClient, listKeyFor, item.event);
          }
        } catch {
          if (abort.signal.aborted) return;
        } finally {
          abort.signal.removeEventListener("abort", abortAttempt);
          attempt.abort();
        }
        if (abort.signal.aborted) return;
        await sleep(RESUBSCRIBE_DELAY_MS, abort.signal);
      }
    };

    void run();
  };

  const stop = (environmentId: string): void => {
    workers.get(environmentId)?.abort();
    workers.delete(environmentId);
  };

  return {
    start,
    stop,
    dispose() {
      for (const worker of workers.values()) worker.abort();
      workers.clear();
    },
  };
}
