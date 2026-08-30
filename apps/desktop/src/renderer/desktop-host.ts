import type { ServerConnection, ServerStatusFeed, Platform } from "@getpie/app";
import { consumeEventIterator } from "@orpc/client";

import type { DesktopBootstrap } from "../shared/desktop-rpc";
import type { DesktopClient } from "./desktop-client";
import { createDesktopConnection } from "./desktop-connection";

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

export type DesktopHost = {
  platform: Platform;
  ready: Promise<void>;
  connection: ServerConnection;
  status: ServerStatusFeed;
};

export function createDesktopHost(
  client: DesktopClient,
  bootstrap: DesktopBootstrap,
  ready: Promise<void>,
): DesktopHost {
  // AppInterface reads this promise only after the desktop shell is mounted.
  // Keep a rejection handler attached before that first read.
  void ready.catch((error: unknown) => {
    if (!isAbortError(error)) console.error("Desktop server readiness failed", error);
  });

  // The feed's snapshot. Every subscriber advances it, so it is tracked with
  // its own revision — a subscriber that opened later must not push the
  // snapshot backwards. Per-subscriber revisions stay local: sharing one would
  // let the first stream to see an event make the others discard it.
  let status = bootstrap.status;
  let statusRevision = bootstrap.statusRevision;

  return {
    platform: {
      openInBrowser: () => client.server.openInBrowser(),
      quit: () => {
        void client.app.quit().catch((error: unknown) => {
          if (!isAbortError(error)) console.error("Failed to request desktop quit", error);
        });
      },
      os: bootstrap.os,
    },
    ready,
    connection: createDesktopConnection(client),
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
