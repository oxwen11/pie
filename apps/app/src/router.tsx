import {
  createRouter as createTanStackRouter,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import type { ReactNode } from "react";

import Loader from "./components/loader";
import type { AppClients } from "./lib/orpc";
import { routeTree } from "./routeTree.gen";

/** TanStack installs a CatchBoundary on every match when this is set. Re-throw
 *  so route errors reach AppInterface's ErrorBoundary instead of the stock
 *  "Something went wrong!" fallback. */
function BubbleRouteError({ error }: ErrorComponentProps): ReactNode {
  throw error;
}

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
    defaultErrorComponent: BubbleRouteError,
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
