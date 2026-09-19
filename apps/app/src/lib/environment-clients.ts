import { createAppClients, disposeAppClients, type AppClients } from "@/lib/orpc";
import type { ServerConnection } from "@/server-connection";

export type EnvironmentClients = {
  get(environmentId: string): AppClients;
  /**
   * Drop remotes missing from `live` or whose connection key changed.
   * `onDrop` runs while the cached clients are still usable.
   */
  prune(
    live: ReadonlyMap<string, ServerConnection>,
    onDrop?: (environmentId: string) => void,
  ): void;
};

type CachedRemote = {
  readonly connectionKey: string;
  readonly clients: AppClients;
};

function connectionKey(connection: ServerConnection): string {
  return `${connection.httpBaseUrl}\0${connection.token}`;
}

export function createEnvironmentClients(input: {
  localId: string;
  local: AppClients;
  resolveRemote: (environmentId: string) => ServerConnection | undefined;
}): EnvironmentClients {
  const remotes = new Map<string, CachedRemote>();

  const forget = (environmentId: string): void => {
    if (environmentId === input.localId) return;
    const cached = remotes.get(environmentId);
    if (cached === undefined) return;
    remotes.delete(environmentId);
    disposeAppClients(cached.clients);
  };

  return {
    get(environmentId: string): AppClients {
      if (environmentId === input.localId) return input.local;

      const connection = input.resolveRemote(environmentId);
      if (connection === undefined) {
        throw new Error(`Environment ${environmentId} is not connected`);
      }

      const key = connectionKey(connection);
      const cached = remotes.get(environmentId);
      if (cached !== undefined) {
        if (cached.connectionKey === key) return cached.clients;
        remotes.delete(environmentId);
        disposeAppClients(cached.clients);
      }
      const clients = createAppClients(connection);
      remotes.set(environmentId, { connectionKey: key, clients });
      return clients;
    },
    prune(live, onDrop) {
      for (const [environmentId, cached] of remotes) {
        const connection = live.get(environmentId);
        if (connection === undefined || connectionKey(connection) !== cached.connectionKey) {
          onDrop?.(environmentId);
          forget(environmentId);
        }
      }
    },
  };
}
