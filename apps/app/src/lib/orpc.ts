import { createPieLink, getWsTicket, type PieClient, type PieClientContext } from "@getpie/client";
import type { ClientLink } from "@orpc/client";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import { QueryCache, QueryClient, type QueryKey } from "@tanstack/react-query";
import { toast } from "sonner";

import type { ServerConnection } from "@/server-connection";

declare module "@tanstack/react-query" {
  interface Register {
    /** Queries with inline error UI do not also raise the global error toast. */
    queryMeta: { errorMode?: "inline" };
  }
}

export type EnvironmentOrpc = ReturnType<typeof createTanstackQueryUtils<PieClient>>;

/**
 * App-wide query policy. Call sites should not repeat these; override only
 * when a key has writers we do not drive (`agent.session.list`) or when a
 * probe must fail fast (draft git availability).
 */
const queryDefaults = {
  staleTime: Infinity,
  refetchOnWindowFocus: "always" as const,
};

function retryQuery(queryClient: QueryClient, queryKey: QueryKey): void {
  queryClient.invalidateQueries({ queryKey }).catch((retryError: unknown) => {
    toast.error(
      `Retry failed: ${retryError instanceof Error ? retryError.message : String(retryError)}`,
    );
  });
}

export function createAppQueryClient(): QueryClient {
  const queryClient: QueryClient = new QueryClient({
    defaultOptions: { queries: queryDefaults },
    queryCache: new QueryCache({
      onError: (error, query) => {
        if (query.meta?.errorMode === "inline") return;
        toast.error(`Error: ${error.message}`, {
          action: {
            label: "retry",
            onClick: () => retryQuery(queryClient, query.queryKey),
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
  const body: unknown = await response.json();
  const token =
    typeof body === "object" && body !== null && "token" in body && typeof body.token === "string"
      ? body.token
      : undefined;
  return getWsTicket(globalThis.location.origin, token);
}

export function createLocalPieLink(
  server?: ServerConnection,
  tokenRef?: { current: string },
): ClientLink<PieClientContext> {
  if (!server) return createPieLink({ getTicket: getBrowserWsTicket });

  const { httpBaseUrl, wsBaseUrl, token } = server;
  const presented = tokenRef ?? { current: token };
  return createPieLink({
    url: `${wsBaseUrl}/ws/rpc`,
    getTicket: () => getWsTicket(httpBaseUrl, presented.current),
  });
}

export function createRemotePieLink(connection: ServerConnection): ClientLink<PieClientContext> {
  return createPieLink({
    url: `${connection.wsBaseUrl}/ws/rpc`,
    getTicket: () => getWsTicket(connection.httpBaseUrl, connection.token),
  });
}

/** One Environment's typed oRPC surface on the app-wide QueryClient. */
export function createEnvironmentOrpc(
  client: PieClient,
  environmentId: string,
  queryClient: QueryClient,
): EnvironmentOrpc {
  const orpc = createTanstackQueryUtils(client, { prefix: environmentId });

  // Draft seeds optimistic rows; the session event stream invalidates this list.
  queryClient.setQueryDefaults(orpc.agent.session.list.key(), {
    staleTime: 30_000,
  });
  const pullRequestDefaults = {
    staleTime: 15_000,
    retry: false,
    meta: { errorMode: "inline" as const },
  };
  queryClient.setQueryDefaults(orpc.pullRequest.current.key(), pullRequestDefaults);
  queryClient.setQueryDefaults(orpc.pullRequest.diff.key(), pullRequestDefaults);
  queryClient.setQueryDefaults(orpc.pullRequest.statuses.key(), pullRequestDefaults);
  queryClient.setQueryDefaults(orpc.pullRequest.list.key(), pullRequestDefaults);
  queryClient.setQueryDefaults(orpc.pullRequest.detail.key(), pullRequestDefaults);

  // Branch discovery is a capability probe; failure must not block or toast over a session.
  queryClient.setQueryDefaults(orpc.git.branch.key(), {
    retry: false,
    meta: { errorMode: "inline" },
  });

  // These queries render their own error state in the workspace panels.
  for (const key of [
    orpc.git.review.key(),
    orpc.git.diff.key(),
    orpc.fs.readTree.key(),
    orpc.fs.readFileString.key(),
  ]) {
    queryClient.setQueryDefaults(key, { meta: { errorMode: "inline" } });
  }

  return orpc;
}

/** Drop only one Environment's entries from the shared TanStack caches. */
export function disposeEnvironmentCache(queryClient: QueryClient, environmentId: string): void {
  const key = [environmentId];
  queryClient.removeQueries({ queryKey: key });
  const mutations = queryClient.getMutationCache().findAll({ mutationKey: key });
  for (const mutation of mutations) queryClient.getMutationCache().remove(mutation);
}
