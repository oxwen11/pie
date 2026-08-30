import { createRouter as createTanStackRouter } from "@tanstack/react-router";

import Loader from "./components/loader";
import type { AppClients } from "./lib/orpc";
import { routeTree } from "./routeTree.gen";

type RouterDependencies = Pick<
  AppClients,
  "httpBaseUrl" | "orpcClient" | "orpcQueryUtils" | "queryClient"
>;

export const createRouter = ({
  httpBaseUrl,
  orpcClient,
  orpcQueryUtils,
  queryClient,
}: RouterDependencies) => {
  const router = createTanStackRouter({
    routeTree,
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
    context: { httpBaseUrl, orpcClient, orpcQueryUtils, queryClient },
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
