import { createRouter as createTanStackRouter } from "@tanstack/react-router";

import Loader from "./components/loader";
import type { AppClients } from "./lib/orpc";
import { routeTree } from "./routeTree.gen";

type RouterDependencies = Pick<AppClients, "orpcClient" | "orpcQueryUtils" | "queryClient"> & {
  readonly localEnvironmentId: string;
  readonly clientsFor: (environmentId: string) => Promise<AppClients>;
};

export const createRouter = ({
  orpcClient,
  orpcQueryUtils,
  queryClient,
  localEnvironmentId,
  clientsFor,
}: RouterDependencies) => {
  const router = createTanStackRouter({
    routeTree,
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
    context: { orpcClient, orpcQueryUtils, queryClient, localEnvironmentId, clientsFor },
    defaultPendingComponent: () => <Loader />,
    defaultNotFoundComponent: () => <div>Not Found</div>,
  });
  return router;
};

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createRouter>;
  }
}
