import { useRouteContext } from "@tanstack/react-router";
import { useSyncExternalStore } from "react";

import type { EnvironmentSnapshot } from "@/platform";
import { usePlatform } from "@/platform-context";

export type ConnectedEnvironment = {
  readonly environmentId: string;
  /** Primary row label — local hostname or remote host alias. */
  readonly title: string;
  /** Secondary row — `This device` locally, otherwise the environment id. */
  readonly description: string;
  readonly kind: "local" | "remote";
};

const EMPTY_SNAPSHOT: EnvironmentSnapshot = {
  revision: 0,
  connecting: [],
  remotes: [],
};

const subscribeNoop = (): (() => void) => () => undefined;
const getEmptySnapshot = (): EnvironmentSnapshot => EMPTY_SNAPSHOT;

/** `dinq@macbook-pro-m1:22` → `macbook-pro-m1` (T3-style short host title). */
function shortRemoteTitle(alias: string): string {
  const host = alias.includes("@") ? alias.slice(alias.lastIndexOf("@") + 1) : alias;
  const withoutPort = host.includes(":") ? host.slice(0, host.lastIndexOf(":")) : host;
  return withoutPort.trim() || alias;
}

/** Local Environment plus every currently connected SSH remote. */
export function useConnectedEnvironments(): ReadonlyArray<ConnectedEnvironment> {
  const { localEnvironmentId } = useRouteContext({ from: "__root__" });
  const platform = usePlatform();
  const snapshot = useSyncExternalStore(
    platform.ssh?.environments.subscribe ?? subscribeNoop,
    platform.ssh?.environments.getSnapshot ?? getEmptySnapshot,
  );
  return [
    {
      environmentId: localEnvironmentId,
      title: platform.hostname ?? "This device",
      description: "This device",
      kind: "local",
    },
    ...snapshot.remotes.map((remote) => ({
      environmentId: remote.environmentId,
      title: shortRemoteTitle(remote.alias),
      description: remote.environmentId,
      kind: "remote" as const,
    })),
  ];
}
