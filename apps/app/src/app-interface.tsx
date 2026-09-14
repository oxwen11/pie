import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { use, useEffect, useRef, useState, type ReactElement } from "react";
import { Toaster } from "sonner";

import "./index.css";

import { contentPanel } from "./content-panel";
import { ChatManager } from "./features/chat/runtime/chat-manager";
import { ChatManagerProvider } from "./features/chat/runtime/chat-manager-provider";
import { OrpcChatSessionTransport } from "./features/chat/runtime/chat-transport";
import { createTerminalPanel } from "./features/terminal/terminal-panel";
import { parseEnvironmentId } from "./lib/environment-id";
import { createAppClients, disposeAppClients, type AppClients } from "./lib/orpc";
import { toSessionRef } from "./lib/session-ref";
import { usePlatform } from "./platform-context";
import { createRouter } from "./router";
import type { ServerConnection } from "./server-connection";
import { useTheme } from "./theme-provider";

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
  void import("react-grab/core").then(({ init }) => init({ telemetry: false }));
}

// Dev only: highlights components as they re-render so you can spot wasted
// renders. Loaded just after React (a tick later than react-scan's ideal
// "before React" position), so it may miss the very first render but catches
// everything after. Not loaded in production or agent-run dev servers. See
// https://react-scan.com.
// Its own version check has no opt-out and is patched out instead — see
// `patches/react-scan@0.5.7.patch`.
if (import.meta.env.DEV && !import.meta.env.PIE_RUN_IN_AGENT) {
  void import("react-scan").then(({ scan }) => scan());
}

type CachedRemote = {
  readonly connectionKey: string;
  readonly clients: AppClients;
};

function connectionKey(connection: ServerConnection): string {
  return `${connection.httpBaseUrl}\0${connection.token}`;
}

async function loadEnvironmentId(server?: ServerConnection): Promise<string> {
  const url = server === undefined ? "/api/environment" : `${server.httpBaseUrl}/api/environment`;
  const headers = server === undefined ? undefined : { authorization: `Bearer ${server.token}` };
  try {
    const response = await globalThis.fetch(url, {
      headers,
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return "local";
    return parseEnvironmentId(await response.json()) ?? "local";
  } catch {
    return "local";
  }
}

class UnknownEnvironmentError extends Error {
  constructor(readonly environmentId: string) {
    super(`Environment ${environmentId} is not connected`);
    this.name = "UnknownEnvironmentError";
  }
}

/** Create once per mount — composition-root singletons, not updatable state. */
function useStable<T>(create: () => T): T {
  const ref = useRef<T | null>(null);
  // Null-guarded lazy init during render is the documented create-once pattern
  // (https://react.dev/reference/react/useRef#avoiding-recreating-the-ref-contents).
  // `react/refs` forbids any `.current` read in render; this ref is the store, not a subscription.
  /* oxlint-disable react/refs */
  if (ref.current === null) {
    const created = create();
    // Create-once composition-root singleton. React documents this null-guarded
    // write during render; the detector still flags the assignment.
    // react-doctor-disable-next-line no-ref-current-in-render
    ref.current = created;
    return created;
  }
  return ref.current;
  /* oxlint-enable react/refs */
}

/** Shared application entry. PlatformProvider is the host seam above it. */
export function AppInterface({
  server,
  environmentId,
  tokenHolder,
}: {
  server?: ServerConnection;
  environmentId?: string;
  /** Host-owned token box. Updated in the event that mints a new token, not during render. */
  tokenHolder?: { current: string };
}): ReactElement {
  usePlatform();
  const identity = server?.httpBaseUrl ?? "default";
  if (environmentId !== undefined) {
    return (
      <AppRuntime
        key={identity}
        server={server}
        environmentId={environmentId}
        tokenHolder={tokenHolder}
      />
    );
  }
  return <ResolveLocalEnvironment key={identity} server={server} tokenHolder={tokenHolder} />;
}

function ResolveLocalEnvironment({
  server,
  tokenHolder,
}: {
  server?: ServerConnection;
  tokenHolder?: { current: string };
}): ReactElement {
  const [promise, _setPromise] = useState(() => loadEnvironmentId(server));
  const environmentId = use(promise);
  return <AppRuntime server={server} environmentId={environmentId} tokenHolder={tokenHolder} />;
}

/** Explicit stable application dependencies, with no host knowledge. */
function AppRuntime({
  server,
  environmentId,
  tokenHolder,
}: {
  server?: ServerConnection;
  environmentId: string;
  tokenHolder?: { current: string };
}): ReactElement {
  const platform = usePlatform();
  const { theme } = useTheme();
  const localClients = useStable(() => createAppClients(server, tokenHolder));
  const remoteClients = useStable(() => new Map<string, CachedRemote>());

  function clientsFor(id: string): AppClients {
    if (id === environmentId) return localClients;
    const remote = platform.ssh?.environments
      .getSnapshot()
      .remotes.find((entry) => entry.environmentId === id);
    if (remote === undefined) throw new UnknownEnvironmentError(id);
    const key = connectionKey(remote.connection);
    const cached = remoteClients.get(id);
    if (cached !== undefined && cached.connectionKey === key) return cached.clients;
    if (cached !== undefined) {
      remoteClients.delete(id);
      disposeAppClients(cached.clients);
    }
    const created = createAppClients(remote.connection);
    remoteClients.set(id, { connectionKey: key, clients: created });
    return created;
  }

  const chatManager = useStable(
    () =>
      new ChatManager((sessionRef) => {
        const clients = clientsFor(sessionRef.environmentId);
        return new OrpcChatSessionTransport(clients.orpcClient.agent, toSessionRef(sessionRef));
      }),
  );

  useEffect(() => {
    const feed = platform.ssh?.environments;
    if (feed === undefined) return undefined;
    const dropRemote = (id: string, clients: AppClients) => {
      remoteClients.delete(id);
      disposeAppClients(clients);
      chatManager.forgetEnvironment(id);
    };
    const prune = () => {
      const live = new Map(
        feed.getSnapshot().remotes.map((remote) => [remote.environmentId, remote] as const),
      );
      for (const [id, cached] of remoteClients) {
        const remote = live.get(id);
        if (remote === undefined) {
          dropRemote(id, cached.clients);
          continue;
        }
        if (cached.connectionKey !== connectionKey(remote.connection)) {
          dropRemote(id, cached.clients);
        }
      }
    };
    prune();
    return feed.subscribe(prune);
  }, [platform.ssh, remoteClients, chatManager]);

  const { orpcClient, queryClient, orpcQueryUtils } = localClients;
  useEffect(() => contentPanel.register(createTerminalPanel(orpcClient)), [orpcClient]);
  const router = useStable(() =>
    createRouter({
      orpcClient,
      queryClient,
      orpcQueryUtils,
      localEnvironmentId: environmentId,
      clientsFor: async (id) => clientsFor(id),
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
        <Toaster theme={theme} />
      </ChatManagerProvider>
    </QueryClientProvider>
  );
}
