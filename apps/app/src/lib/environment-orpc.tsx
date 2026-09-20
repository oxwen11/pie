import { useRouteContext } from "@tanstack/react-router";
import { createContext, use, type ReactNode } from "react";

import type { EnvironmentOrpc } from "@/lib/orpc";

const EnvironmentOrpcContext = createContext<EnvironmentOrpc | null>(null);

export function EnvironmentOrpcProvider({
  orpc,
  children,
}: {
  orpc: EnvironmentOrpc;
  children: ReactNode;
}): ReactNode {
  return <EnvironmentOrpcContext value={orpc}>{children}</EnvironmentOrpcContext>;
}

/** Session/workspace plane under EnvironmentOrpcProvider. */
export function useEnvironmentOrpc(): EnvironmentOrpc {
  const orpc = use(EnvironmentOrpcContext);
  if (orpc === null) {
    throw new Error("useEnvironmentOrpc must be rendered inside EnvironmentOrpcProvider");
  }
  return orpc;
}

/** Catalog plane for features that are intentionally local-only. */
export function useLocalOrpc(): EnvironmentOrpc {
  const { environmentRpc, localEnvironmentId } = useRouteContext({ from: "__root__" });
  return environmentRpc.for(localEnvironmentId);
}

/** Prefer an enclosing Environment provider; otherwise use the local daemon. */
export function useCatalogOrpc(): EnvironmentOrpc {
  const scoped = use(EnvironmentOrpcContext);
  const local = useLocalOrpc();
  return scoped ?? local;
}
