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

function createQueryClient(): QueryClient {
  const queryClient: QueryClient = new QueryClient({
    queryCache: new QueryCache({
      onError: (error) => {
        toast.error(`Error: ${error.message}`, {
          action: {
            label: "retry",
            onClick: () => {
              queryClient.invalidateQueries();
            },
          },
        });
      },
    }),
  });
  return queryClient;
}

/** Create the stable oRPC, TanStack Query, and oRPC Query dependencies for a server. */
export function createAppClients(server?: ServerConnection): AppClients {
  const queryClient = createQueryClient();

  if (!server) {
    const orpcClient = createPieClient();
    return {
      orpcClient,
      queryClient,
      orpcQueryUtils: createTanstackQueryUtils(orpcClient),
    };
  }

  const { httpBaseUrl, wsBaseUrl, token } = server;
  const orpcClient = createPieClient({
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

  return {
    orpcClient,
    queryClient,
    orpcQueryUtils: createTanstackQueryUtils(orpcClient),
  };
}
