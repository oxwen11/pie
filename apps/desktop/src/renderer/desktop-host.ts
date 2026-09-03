import type { ServerStatusFeed, Platform, EnvironmentSnapshot } from "@getpie/app";
import { consumeEventIterator } from "@orpc/client";

import type { ServerConnection, DesktopBootstrap } from "../shared/desktop-rpc";
import type { DesktopClient } from "./desktop-client";

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

export type DesktopHost = {
  platform: Platform;
  server: Promise<ServerConnection>;
  /**
   * Re-fetch the current connection. The daemon mints a fresh token (and can
   * land on a new port) every time it respawns, so the startup connection goes
   * stale on every server restart — consumers re-fetch when the status feed
   * reports ready again.
   */
  refreshServer: () => Promise<ServerConnection>;
  status: ServerStatusFeed;
};

export function createDesktopHost(
  client: DesktopClient,
  bootstrap: DesktopBootstrap,
  server: Promise<ServerConnection>,
): DesktopHost {
  void server.catch((error: unknown) => {
    if (!isAbortError(error)) console.error("Desktop server connection failed", error);
  });

  let status = bootstrap.status;
  let statusRevision = bootstrap.statusRevision;
  let environments = bootstrap.environments;

  const environmentListeners = new Set<(snapshot: EnvironmentSnapshot) => void>();

  return {
    platform: {
      quit: () => {
        void client.app.quit().catch((error: unknown) => {
          if (!isAbortError(error)) console.error("Failed to request desktop quit", error);
        });
      },
      os: bootstrap.os,
      ssh: {
        client: bootstrap.sshClient,
        environments: {
          getSnapshot: () => environments,
          subscribe: (listener) => {
            environmentListeners.add(listener);
            const controller = new AbortController();
            let revision = bootstrap.environments.revision;
            const unsubscribe = consumeEventIterator(
              client.environments.subscribe({ after: revision }, { signal: controller.signal }),
              {
                onEvent: (snapshot) => {
                  if (snapshot.revision <= revision) return;
                  revision = snapshot.revision;
                  environments = snapshot;
                  for (const current of environmentListeners) current(snapshot);
                },
                onError: (error) => {
                  if (!controller.signal.aborted && !isAbortError(error)) {
                    console.error("Desktop environment stream failed", error);
                  }
                },
                onFinish: () => {},
              },
            );

            return () => {
              environmentListeners.delete(listener);
              controller.abort();
              void unsubscribe().catch((error: unknown) => {
                if (!isAbortError(error)) {
                  console.error("Failed to unsubscribe from desktop environments", error);
                }
              });
            };
          },
        },
        discoverHosts: () => client.environments.discoverSshHosts(),
        connect: (target) => client.environments.connectSsh({ target }),
        disconnect: () => client.environments.disconnectSsh(),
        remove: (id) => client.environments.removeSsh({ id }),
      },
      tailscale: {
        client: bootstrap.tailscaleClient,
        snapshot: () => client.tailscale.snapshot(),
        enableServe: () => client.tailscale.enableServe(),
        disableServe: () => client.tailscale.disableServe(),
      },
    },
    server,
    refreshServer: () => client.server.connection(),
    status: {
      getSnapshot: () => status,
      subscribe: (listener) => {
        const controller = new AbortController();
        let revision = bootstrap.statusRevision;
        const unsubscribe = consumeEventIterator(
          client.status.subscribe({ after: revision }, { signal: controller.signal }),
          {
            onEvent: (snapshot) => {
              if (snapshot.revision <= revision) return;
              revision = snapshot.revision;
              if (snapshot.revision > statusRevision) {
                statusRevision = snapshot.revision;
                status = snapshot.status;
              }
              listener(snapshot.status);
            },
            onError: (error) => {
              if (!controller.signal.aborted && !isAbortError(error)) {
                console.error("Desktop status stream failed", error);
              }
            },
            onFinish: () => {},
          },
        );

        return () => {
          controller.abort();
          void unsubscribe().catch((error: unknown) => {
            if (!isAbortError(error)) {
              console.error("Failed to unsubscribe from desktop status", error);
            }
          });
        };
      },
      retry: () => {
        void client.server.retry().catch((error: unknown) => {
          if (!isAbortError(error)) console.error("Failed to retry desktop server", error);
        });
      },
    },
  };
}
