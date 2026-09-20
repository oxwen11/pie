import type { PieClient, PieClientContext } from "@getpie/client";
import { createORPCClient, DynamicLink, type ClientLink } from "@orpc/client";
import type { QueryClient } from "@tanstack/react-query";

import {
  createEnvironmentOrpc,
  createRemotePieLink,
  disposeEnvironmentCache,
  type EnvironmentOrpc,
} from "@/lib/orpc";
import type { ServerConnection } from "@/server-connection";

export type EnvironmentRpc = {
  readonly localId: string;
  readonly queryClient: QueryClient;
  /** Stable, environment-prefixed oRPC utilities with context injection. */
  for(environmentId: string): EnvironmentOrpc;
  /** Upsert live remote links and remove departed Environments. */
  sync(
    live: ReadonlyMap<string, ServerConnection>,
    onRemove?: (environmentId: string) => void,
  ): void;
};

type LinkEntry = {
  readonly connectionKey: string;
  readonly link: ClientLink<PieClientContext>;
};

function connectionKey(connection: ServerConnection): string {
  return `${connection.httpBaseUrl}\0${connection.token}`;
}

function disposeLink(link: ClientLink<PieClientContext>): void {
  const disposable = link as ClientLink<PieClientContext> & { dispose?: () => void };
  disposable.dispose?.();
}

export function createEnvironmentRpc(input: {
  localId: string;
  localLink: ClientLink<PieClientContext>;
  queryClient: QueryClient;
  resolveRemote: (environmentId: string) => ServerConnection | undefined;
  createRemoteLink?: (connection: ServerConnection) => ClientLink<PieClientContext>;
}): EnvironmentRpc {
  const createLink =
    input.createRemoteLink ?? ((connection: ServerConnection) => createRemotePieLink(connection));
  const links = new Map<string, LinkEntry>([
    [input.localId, { connectionKey: "local", link: input.localLink }],
  ]);
  const environments = new Map<string, EnvironmentOrpc>();

  const resolveLink = (environmentId: string): ClientLink<PieClientContext> => {
    const cached = links.get(environmentId);
    if (environmentId === input.localId) {
      if (cached === undefined) throw new Error("Local Environment link is missing");
      return cached.link;
    }

    const connection = input.resolveRemote(environmentId);
    if (connection === undefined) {
      throw new Error(`Environment ${environmentId} is not connected`);
    }
    const key = connectionKey(connection);
    if (cached?.connectionKey === key) return cached.link;

    if (cached !== undefined) disposeLink(cached.link);
    const link = createLink(connection);
    links.set(environmentId, { connectionKey: key, link });
    return link;
  };

  const dynamicLink = new DynamicLink<PieClientContext>((options) => {
    const environmentId = options.context?.environmentId;
    if (environmentId === undefined) {
      throw new Error("oRPC call is missing environmentId context");
    }
    return resolveLink(environmentId);
  });

  const createScopedOrpc = (environmentId: string): EnvironmentOrpc => {
    resolveLink(environmentId);
    const client = createORPCClient<PieClient>(dynamicLink, {
      interceptors: [
        (options) =>
          options.next({
            ...options,
            context: { ...options.context, environmentId },
          }),
      ],
    });
    return createEnvironmentOrpc(client, environmentId, input.queryClient);
  };

  return {
    localId: input.localId,
    queryClient: input.queryClient,
    for(environmentId) {
      const cached = environments.get(environmentId);
      if (cached !== undefined) return cached;
      const orpc = createScopedOrpc(environmentId);
      environments.set(environmentId, orpc);
      return orpc;
    },
    sync(live, onRemove) {
      for (const [environmentId, connection] of live) {
        const key = connectionKey(connection);
        const cached = links.get(environmentId);
        if (cached?.connectionKey !== key) {
          if (cached !== undefined) disposeLink(cached.link);
          links.set(environmentId, { connectionKey: key, link: createLink(connection) });
        }
      }

      for (const environmentId of links.keys()) {
        if (environmentId === input.localId || live.has(environmentId)) continue;
        onRemove?.(environmentId);
        const removed = links.get(environmentId);
        if (removed !== undefined) disposeLink(removed.link);
        links.delete(environmentId);
        environments.delete(environmentId);
        disposeEnvironmentCache(input.queryClient, environmentId);
      }
    },
  };
}
