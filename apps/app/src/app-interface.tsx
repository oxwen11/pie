import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { useEffect, useState, type ReactElement } from "react";
import { Toaster } from "sonner";

import "./index.css";

import { ChatManager } from "./features/chat/runtime/chat-manager";
import { ChatManagerProvider } from "./features/chat/runtime/chat-manager-provider";
import { OrpcChatSessionTransport } from "./features/chat/runtime/chat-transport";
import { createAppClients, type AppClients } from "./lib/orpc";
import { toSessionRef } from "./lib/session-ref";
import { usePlatform } from "./platform-context";
import { createRouter } from "./router";
import type { ServerConnection } from "./server-connection";

declare global {
  interface ImportMetaEnv {
    readonly PIE_RUN_IN_AGENT: boolean;
  }
}

// Dev only: hover any element and press Cmd/Ctrl+C to copy it with its React
// component stack and source locations, for pasting into a coding agent. The
// guard is statically false in production and in dev servers launched by coding
// agents, so react-grab is not loaded there. See https://react-grab.com.
//
// `/core` is the entry that doesn't auto-init, so it takes `telemetry: false` —
// the default init fires a version check at react-grab.com, which the Electron
// renderer's CSP blocks with a console error.
if (import.meta.env.DEV && !import.meta.env.PIE_RUN_IN_AGENT) {
  void import("react-grab/core").then(({ init }) => {
    init({ telemetry: false });
  });
}

// Dev only: highlights components as they re-render so you can spot wasted
// renders. Loaded just after React (a tick later than react-scan's ideal
// "before React" position), so it may miss the very first render but catches
// everything after. Not loaded in production or agent-run dev servers. See
// https://react-scan.com.
// Its own version check has no opt-out and is patched out instead — see
// `patches/react-scan@0.5.7.patch`.
if (import.meta.env.DEV && !import.meta.env.PIE_RUN_IN_AGENT) {
  // react-scan's intro is another %c console.log; hideIntro skips it.
  Object.assign(window, { hideIntro: true });
  void import("react-scan").then(({ scan }) => scan());
}

async function loadLocalEnvironmentId(server?: ServerConnection): Promise<string> {
  if (server === undefined) return "local";
  try {
    const response = await globalThis.fetch(`${server.httpBaseUrl}/api/environment`, {
      headers: { authorization: `Bearer ${server.token}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return "local";
    const body = (await response.json()) as { id?: unknown };
    return typeof body.id === "string" && body.id.length > 0 ? body.id : "local";
  } catch {
    return "local";
  }
}

/** Shared application entry. PlatformProvider is the host seam above it. */
export function AppInterface({
  server,
  environmentId,
}: {
  server?: ServerConnection;
  environmentId?: string;
}): ReactElement {
  usePlatform();
  const identity = server ? `${server.httpBaseUrl}\0${server.token}` : "default";
  return <AppRuntime key={identity} server={server} environmentId={environmentId} />;
}

/** Explicit stable application dependencies, with no host knowledge. */
function AppRuntime({
  server,
  environmentId,
}: {
  server?: ServerConnection;
  environmentId?: string;
}): ReactElement {
  const platform = usePlatform();
  const localClients = useState(() => createAppClients(server))[0];
  const remoteClients = useState(() => new Map<string, AppClients>())[0];

  useEffect(() => {
    const feed = platform.ssh?.environments;
    if (feed === undefined) return undefined;
    const sync = () => {
      for (const remote of feed.getSnapshot().remotes) {
        if (!remoteClients.has(remote.environmentId)) {
          remoteClients.set(remote.environmentId, createAppClients(remote.connection));
        }
      }
    };
    sync();
    return feed.subscribe(sync);
  }, [platform.ssh, remoteClients]);

  const clientsFor = async (id: string): Promise<AppClients> => {
    const resolved = id === "pending" ? await loadLocalEnvironmentId(server) : id;
    if (resolved === (environmentId ?? "local") || resolved === "local" || resolved === "pending") {
      return localClients;
    }
    const cached = remoteClients.get(resolved);
    if (cached) return cached;
    const remote = platform.ssh?.environments
      .getSnapshot()
      .remotes.find((entry) => entry.environmentId === resolved);
    if (remote === undefined) return localClients;
    const created = createAppClients(remote.connection);
    remoteClients.set(resolved, created);
    return created;
  };

  const [{ orpcClient, queryClient, orpcQueryUtils }] = useState(() => localClients);
  const [router] = useState(() =>
    createRouter({
      orpcClient,
      queryClient,
      orpcQueryUtils,
      localEnvironmentId: environmentId ?? "local",
      clientsFor,
    }),
  );
  const [chatManager] = useState(
    () =>
      new ChatManager((ref) => {
        const clients =
          ref.environmentId === (environmentId ?? "local")
            ? localClients
            : (remoteClients.get(ref.environmentId) ?? localClients);
        return new OrpcChatSessionTransport(clients.orpcClient.agent, toSessionRef(ref));
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <ChatManagerProvider manager={chatManager}>
        <RouterProvider router={router} />
        {/*
         * The app's only error surface. Every `toast.*` call — the QueryClient's
         * global query-error handler in lib/orpc.ts, failed imports, failed
         * session creates, failed resumes — renders nothing without this mount.
         */}
        <Toaster theme="system" />
      </ChatManagerProvider>
    </QueryClientProvider>
  );
}
