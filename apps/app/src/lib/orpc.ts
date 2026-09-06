import { createPieClient, getWsTicket, type PieClient } from "@getpie/client";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import { QueryCache, QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import type { ServerConnection } from "@/server-connection";

declare module "@tanstack/react-query" {
  interface Register {
    /** Queries with inline error UI do not also raise the global error toast. */
    queryMeta: { errorMode?: "inline" };
  }
}

export type AppClients = {
  orpcClient: PieClient;
  queryClient: QueryClient;
  orpcQueryUtils: ReturnType<typeof createTanstackQueryUtils<PieClient>>;
};

/**
 * App-wide query policy. Call sites should not repeat these; override only
 * when a key has writers we do not drive (`agent.session.list`) or when a
 * probe must fail fast (draft git availability).
 */
const queryDefaults = {
  staleTime: Infinity,
  refetchOnWindowFocus: "always" as const,
};

function retryAllQueries(queryClient: QueryClient): void {
  queryClient.invalidateQueries().catch((retryError: unknown) => {
    toast.error(
      `Retry failed: ${retryError instanceof Error ? retryError.message : String(retryError)}`,
    );
  });
}

function createQueryClient(): QueryClient {
  const queryClient: QueryClient = new QueryClient({
    defaultOptions: { queries: queryDefaults },
    queryCache: new QueryCache({
      onError: (error, query) => {
        if (query.meta?.errorMode === "inline") return;
        toast.error(`Error: ${error.message}`, {
          action: {
            label: "retry",
            onClick: () => {
              retryAllQueries(queryClient);
            },
          },
        });
      },
    }),
  });
  return queryClient;
}

async function getBrowserWsTicket(): Promise<string> {
  const response = await globalThis.fetch("/api/bootstrap");
  if (!response.ok) {
    throw new Error(`Failed to bootstrap the local server: ${response.status}`);
  }
  const body = (await response.json()) as { token: string | null };
  const token = typeof body.token === "string" ? body.token : undefined;
  return getWsTicket(globalThis.location.origin, token);
}

function createOrpcClient(server?: ServerConnection): PieClient {
  if (!server) return createPieClient({ getTicket: getBrowserWsTicket });

  const { httpBaseUrl, wsBaseUrl, token } = server;
  return createPieClient({
    url: `${wsBaseUrl}/ws/rpc`,
    getTicket: () => getWsTicket(httpBaseUrl, token),
  });
}

/** Create the stable oRPC, TanStack Query, and oRPC Query dependencies for a server. */
export function createAppClients(server?: ServerConnection): AppClients {
  const queryClient = createQueryClient();
  const orpcClient = createOrpcClient(server);
  const orpcQueryUtils = createTanstackQueryUtils(orpcClient);

  // Draft seeds optimistic rows; the session event stream invalidates this list.
  queryClient.setQueryDefaults(orpcQueryUtils.agent.session.list.key(), {
    staleTime: 30_000,
  });
  const pullRequestDefaults = {
    staleTime: 15_000,
    retry: false,
    meta: { errorMode: "inline" as const },
  };
  queryClient.setQueryDefaults(orpcQueryUtils.pullRequest.current.key(), pullRequestDefaults);
  queryClient.setQueryDefaults(orpcQueryUtils.pullRequest.diff.key(), pullRequestDefaults);
  queryClient.setQueryDefaults(orpcQueryUtils.pullRequest.statuses.key(), pullRequestDefaults);
  queryClient.setQueryDefaults(orpcQueryUtils.pullRequest.list.key(), pullRequestDefaults);
  queryClient.setQueryDefaults(orpcQueryUtils.pullRequest.detail.key(), pullRequestDefaults);

  // These queries render their own error state in the workspace panels.
  for (const key of [
    orpcQueryUtils.git.review.key(),
    orpcQueryUtils.git.diff.key(),
    orpcQueryUtils.fs.readTree.key(),
    orpcQueryUtils.fs.readFileString.key(),
  ]) {
    queryClient.setQueryDefaults(key, { meta: { errorMode: "inline" } });
  }

  return { orpcClient, queryClient, orpcQueryUtils };
}
