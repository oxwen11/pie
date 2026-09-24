import {
  createRouter as createTanStackRouter,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import type { ReactNode } from "react";

import Loader from "./components/loader";
import type { EnvironmentRpc } from "./lib/environment-rpc";
import { routeTree } from "./routeTree.gen";

/** TanStack installs a CatchBoundary on every match when this is set. Re-throw
 *  so route errors reach AppInterface's ErrorBoundary instead of the stock
 *  "Something went wrong!" fallback. */
function BubbleRouteError({ error }: ErrorComponentProps): ReactNode {
  throw error;
}

type RouterDependencies = {
  readonly localEnvironmentId: string;
  readonly environmentRpc: EnvironmentRpc;
};

export const createRouter = ({ localEnvironmentId, environmentRpc }: RouterDependencies) => {
  const router = createTanStackRouter({
    routeTree,
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
    context: {
      localEnvironmentId,
      environmentRpc,
    },
    defaultPendingComponent: () => <Loader />,
    defaultErrorComponent: BubbleRouteError,
    defaultNotFoundComponent: () => <div>Not Found</div>,
  });
  return router;
};

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createRouter>;
  }
}
