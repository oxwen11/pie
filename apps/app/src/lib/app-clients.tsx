import { QueryClientProvider } from "@tanstack/react-query";
import { useRouteContext } from "@tanstack/react-router";
import { createContext, use, type ReactNode } from "react";

import type { AppClients } from "@/lib/orpc";

const AppClientsContext = createContext<AppClients | null>(null);

export function AppClientsProvider({
  clients,
  children,
}: {
  clients: AppClients;
  children: ReactNode;
}): ReactNode {
  return (
    <QueryClientProvider client={clients.queryClient}>
      <AppClientsContext value={clients}>{children}</AppClientsContext>
    </QueryClientProvider>
  );
}

/** Session-scoped clients under SessionBound / AppClientsProvider. */
export function useAppClients(): AppClients {
  const clients = use(AppClientsContext);
  if (clients === null) {
    throw new Error("useAppClients must be rendered inside AppClientsProvider");
  }
  return clients;
}

/** Catalog / sidebar plane — always the local Environment. */
export function useLocalAppClients(): AppClients {
  const { environmentClients, localEnvironmentId } = useRouteContext({ from: "__root__" });
  return environmentClients.get(localEnvironmentId);
}
