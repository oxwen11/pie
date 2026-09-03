import { createRouter as createTanStackRouter } from "@tanstack/react-router";

import Loader from "./components/loader";
import type { AppClients } from "./lib/orpc";
import { routeTree } from "./routeTree.gen";

type RouterDependencies = Pick<AppClients, "orpcClient" | "orpcQueryUtils" | "queryClient">;

export const createRouter = ({ orpcClient, orpcQueryUtils, queryClient }: RouterDependencies) => {
  const router = createTanStackRouter({
    routeTree,
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
    context: { orpcClient, orpcQueryUtils, queryClient },
    defaultPendingComponent: () => <Loader />,
    defaultNotFoundComponent: () => <div>Not Found</div>,
  });
  return router;
};

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createRouter>;
  }
  interface StaticDataRouteOption {
    /** Card title. `false` hides it. Unset keeps the session / new-chat heading. */
    readonly cardHeading?: string | false;
    /** `false` hides the card header except where shell controls are required. */
    readonly cardHeader?: false;
  }
}
