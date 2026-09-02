import type { SessionRef } from "@getpie/contract";
import { createContext, useContext, useMemo, type ReactNode } from "react";

type IsSessionActive = (ref: SessionRef) => boolean;

type CurrentSessionContextValue = {
  readonly isSessionActive: IsSessionActive;
};

const CurrentSessionContext = createContext<CurrentSessionContextValue | null>(null);

export function CurrentSessionProvider({
  children,
  isSessionActive,
}: {
  readonly children: ReactNode;
  readonly isSessionActive: IsSessionActive;
}) {
  // Keep this value fresh when the composition root re-renders after
  // navigation. The checker itself reads the router at call time, so action
  // callbacks also observe the current route after they were mounted.
  const value = useMemo(() => ({ isSessionActive }), [isSessionActive]);

  return <CurrentSessionContext value={value}>{children}</CurrentSessionContext>;
}

export function useCurrentSession(): IsSessionActive {
  const context = useContext(CurrentSessionContext);
  if (context === null) {
    throw new Error("useCurrentSession must be used within CurrentSessionProvider");
  }
  return context.isSessionActive;
}
