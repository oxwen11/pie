import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { use, useEffect, useState, type ReactElement, type ReactNode } from "react";
import { ErrorBoundary } from "react-error-boundary";
import { Toaster } from "sonner";

import "./index.css";

import { AppErrorPage } from "./components/app-error-page";
import { ChatManager } from "./features/chat/runtime/chat-manager";
import { ChatManagerProvider } from "./features/chat/runtime/chat-manager-provider";
import { OrpcChatSessionTransport } from "./features/chat/runtime/chat-transport";
import { parseEnvironmentId } from "./lib/environment-id";
import { createAppClients, disposeAppClients, type AppClients } from "./lib/orpc";
import { toSessionRef } from "./lib/session-ref";
import { usePlatform } from "./platform-context";
import { createRouter } from "./router";
import type { ServerConnection } from "./server-connection";
import { ThemeProvider, useTheme } from "./theme-provider";
import { useStable } from "./use-stable";

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
  return (
    <ErrorBoundary FallbackComponent={AppErrorPage}>
      <AppHost server={server} environmentId={environmentId} />
    </ErrorBoundary>
  );
}

function AppHost({
  server,
  environmentId,
}: {
  server?: ServerConnection;
  environmentId?: string;
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
  const promise = useStable(() => loadEnvironmentId(server));
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
  const localClients = useState(() => createAppClients(server, tokenHolder))[0];
  const remoteClients = useState(() => new Map<string, CachedRemote>())[0];
  const chatManagerHolder = useState(() => ({ current: null as ChatManager | null }))[0];

  useEffect(() => {
    const feed = platform.ssh?.environments;
    if (feed === undefined) return undefined;
    const dropRemote = (id: string, clients: AppClients) => {
      remoteClients.delete(id);
      disposeAppClients(clients);
      chatManagerHolder.current?.forgetEnvironment(id);
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
  }, [platform.ssh, remoteClients, chatManagerHolder]);

  const clientsFor = (id: string): AppClients => {
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
      chatManagerHolder.current?.forgetEnvironment(id);
    }
    const created = createAppClients(remote.connection);
    remoteClients.set(id, { connectionKey: key, clients: created });
    return created;
  };

  const [{ orpcClient, queryClient, orpcQueryUtils }] = useState(() => localClients);
  const [chatManager] = useState(
    () =>
      new ChatManager((ref) => {
        const clients = clientsFor(ref.environmentId);
        return new OrpcChatSessionTransport(clients.orpcClient.agent, toSessionRef(ref));
      }),
  );
  chatManagerHolder.current = chatManager;
  const [router] = useState(() =>
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
      <ServerThemeProvider orpcQueryUtils={orpcQueryUtils}>
        <ChatManagerProvider manager={chatManager}>
          <RouterProvider router={router} />
          {/*
           * The app's only error surface. Every `toast.*` call — the QueryClient's
           * global query-error handler in lib/orpc.ts, failed imports, failed
           * session creates, failed resumes — renders nothing without this mount.
           */}
          <AppToaster />
        </ChatManagerProvider>
      </ServerThemeProvider>
    </QueryClientProvider>
  );
}

function ServerThemeProvider({
  children,
  orpcQueryUtils,
}: {
  children: ReactNode;
  orpcQueryUtils: AppClients["orpcQueryUtils"];
}): ReactElement {
  const { data } = useQuery({
    ...orpcQueryUtils.settings.get.queryOptions(),
  });
  return <ThemeProvider serverTheme={data?.appearance.theme}>{children}</ThemeProvider>;
}

function AppToaster(): ReactElement {
  const { theme } = useTheme();
  return <Toaster theme={theme} />;
}
