import type { SessionRef } from "@getpie/contract";
import { useRouteContext } from "@tanstack/react-router";
import {
  createContext,
  use,
  useCallback,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import { useSessionListSync } from "@/features/projects/use-session-list-sync";
import { createQueryRepair } from "@/lib/query-repair";
import { usePlatform } from "@/platform-context";

import { PullRequestDemand } from "./pull-request-demand";
import { RendererVisibility } from "./renderer-visibility";
import { VisibleSessionRows } from "./visible-session-rows";

const DemandContext = createContext<{
  demand: PullRequestDemand;
  rows: VisibleSessionRows;
  visibility: RendererVisibility;
} | null>(null);

export function PullRequestDemandProvider({ children }: { children: ReactNode }) {
  const { orpcClient, orpcQueryUtils, queryClient } = useRouteContext({ from: "__root__" });
  const platform = usePlatform();
  const [runtime] = useState(() => {
    const demand = new PullRequestDemand((input) =>
      orpcClient.pullRequest.demand(input, { signal: AbortSignal.timeout(15_000) }),
    );
    const source = Symbol();
    return {
      demand,
      rows: new VisibleSessionRows((refs) => demand.replace(source, refs)),
      visibility: new RendererVisibility(platform.visibility),
    };
  });
  const [repair] = useState(() => {
    const statuses = createQueryRepair(queryClient, orpcQueryUtils.pullRequest.statuses.key());
    const details = createQueryRepair(queryClient, orpcQueryUtils.pullRequest.detail.key());
    return () => {
      statuses();
      details();
    };
  });
  const onSubscribed = useCallback(() => {
    runtime.demand.reconnect();
    repair();
  }, [runtime, repair]);
  const onCollectionEvent = useCallback(
    (type: string) => {
      if (type === "session.pull-requests.updated") repair();
    },
    [repair],
  );
  useSessionListSync(onSubscribed, onCollectionEvent);

  useEffect(() => {
    const unsubscribe = runtime.visibility.subscribe(() =>
      runtime.demand.setVisible(runtime.visibility.getSnapshot()),
    );
    const stopVisibility = runtime.visibility.start();
    const stopRows = runtime.rows.start();
    return () => {
      stopRows();
      stopVisibility();
      unsubscribe();
    };
  }, [runtime]);

  return <DemandContext value={runtime}>{children}</DemandContext>;
}

function useDemandRuntime() {
  const runtime = use(DemandContext);
  if (!runtime) throw new Error("Pull request demand requires the shell provider");
  return runtime;
}

export function usePullRequestRow(ref: SessionRef, displayed: boolean) {
  const { rows } = useDemandRuntime();
  const { projectId, sessionId } = ref;
  return useCallback(
    (element: HTMLLIElement | null) => {
      if (!element || !displayed) return;
      return rows.observe(element, { projectId, sessionId });
    },
    [rows, displayed, projectId, sessionId],
  );
}

/** Only the mounted, active panel calls this; hidden documents disable detail reads too. */
export function usePullRequestPanelDemand(ref: SessionRef): boolean {
  const { demand, visibility } = useDemandRuntime();
  const { projectId, sessionId } = ref;
  useEffect(() => {
    const source = Symbol();
    demand.replace(source, [{ projectId, sessionId }]);
    return () => demand.replace(source, []);
  }, [demand, projectId, sessionId]);
  return useSyncExternalStore(visibility.subscribe, visibility.getSnapshot);
}
