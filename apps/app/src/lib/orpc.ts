import { createPieClient, type PieClient } from "@getpie/client";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import { QueryCache, QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import type { ServerConnection } from "@/server-connection";

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
      onError: (error) => {
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

function createOrpcClient(server?: ServerConnection): PieClient {
  if (!server) return createPieClient();

  const { httpBaseUrl, wsBaseUrl, token } = server;
  return createPieClient({
    url: `${wsBaseUrl}/ws/rpc`,
    getTicket: async () => {
      const response = await globalThis.fetch(`${httpBaseUrl}/api/ws-ticket`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        throw new Error(`Failed to obtain a WebSocket ticket: ${response.status}`);
      }
      const body = (await response.json()) as { ticket: string };
      return body.ticket;
    },
  });
}

/** Create the stable oRPC, TanStack Query, and oRPC Query dependencies for a server. */
export function createAppClients(server?: ServerConnection): AppClients {
  const queryClient = createQueryClient();
  const orpcClient = createOrpcClient(server);
  const orpcQueryUtils = createTanstackQueryUtils(orpcClient);

  // Draft seeds optimistic rows; `useSessionListSync` patches titles. Hold briefly.
  queryClient.setQueryDefaults(orpcQueryUtils.agent.session.list.key(), {
    staleTime: 30_000,
  });

  return { orpcClient, queryClient, orpcQueryUtils };
}
