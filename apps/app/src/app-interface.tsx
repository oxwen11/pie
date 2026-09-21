import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { useEffect, useState, type ReactElement, type ReactNode } from "react";
import { ErrorBoundary } from "react-error-boundary";
import { Toaster } from "sonner";

import "./index.css";

import { AppErrorPage } from "./components/app-error-page";
import { contentPanel } from "./content-panel";
import { ChatManager } from "./features/chat/runtime/chat-manager";
import { ChatManagerProvider } from "./features/chat/runtime/chat-manager-provider";
import { OrpcChatSessionTransport } from "./features/chat/runtime/chat-transport";
import { createEnvironmentCatalog } from "./features/projects/environment-catalog";
import { createTerminalPanel } from "./features/terminal/terminal-panel";
import { parseEnvironmentId } from "./lib/environment-id";
import { createEnvironmentRpc } from "./lib/environment-rpc";
import { createAppQueryClient, createLocalPieLink, type EnvironmentOrpc } from "./lib/orpc";
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
      <AppHost server={server} environmentId={environmentId} tokenHolder={tokenHolder} />
    </ErrorBoundary>
  );
}

function AppHost({
  server,
  environmentId,
  tokenHolder,
}: {
  server?: ServerConnection;
  environmentId?: string;
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
}): ReactElement | null {
  const [environmentId, setEnvironmentId] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void loadEnvironmentId(server).then((id) => {
      if (!cancelled) setEnvironmentId(id);
      return undefined;
    });
    return () => {
      cancelled = true;
    };
  }, [server]);
  if (environmentId === null) return null;
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
  const queryClient = useStable(createAppQueryClient);
  const environmentRpc = useStable(() =>
    createEnvironmentRpc({
      localId: environmentId,
      localLink: createLocalPieLink(server, tokenHolder),
      queryClient,
      resolveRemote: (id) =>
        platform.ssh?.environments.getSnapshot().remotes.find((entry) => entry.environmentId === id)
          ?.connection,
    }),
  );

  const chatManager = useStable(
    () =>
      new ChatManager((sessionRef) => {
        const session = environmentRpc.for(sessionRef.environmentId).agent.session;
        return new OrpcChatSessionTransport(
          {
            session: {
              prompt: session.prompt.call,
              interrupt: session.interrupt.call,
              replaceQueue: session.replaceQueue.call,
              respondToAgentRequest: session.respondToAgentRequest.call,
              getSnapshot: session.getSnapshot.call,
              getMessages: session.getMessages.call,
              subscribe: session.subscribe.call,
            },
          },
          sessionRef.ref,
        );
      }),
  );
  const environmentCatalog = useStable(() => createEnvironmentCatalog(environmentRpc));

  useEffect(() => {
    environmentCatalog.start(environmentId);
    const feed = platform.ssh?.environments;
    if (feed === undefined) return () => environmentCatalog.dispose();
    const sync = () => {
      const live = new Map(
        feed.getSnapshot().remotes.map((remote) => [remote.environmentId, remote.connection]),
      );
      environmentRpc.sync(live, (id) => {
        environmentCatalog.stop(id);
        chatManager.forgetEnvironment(id);
        contentPanel.forgetAllForEnvironment(id);
      });
      for (const id of live.keys()) environmentCatalog.start(id);
    };
    sync();
    const unsubscribe = feed.subscribe(sync);
    return () => {
      unsubscribe();
      environmentCatalog.dispose();
    };
  }, [platform.ssh, environmentId, environmentRpc, environmentCatalog, chatManager]);

  useEffect(() => contentPanel.register(createTerminalPanel(environmentRpc)), [environmentRpc]);
  const router = useStable(() =>
    createRouter({
      localEnvironmentId: environmentId,
      environmentRpc,
    }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <ServerThemeProvider orpc={environmentRpc.for(environmentId)}>
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
  orpc,
}: {
  children: ReactNode;
  orpc: EnvironmentOrpc;
}): ReactElement {
  const { data } = useQuery(orpc.settings.get.queryOptions());
  return <ThemeProvider serverTheme={data?.appearance.theme}>{children}</ThemeProvider>;
}

function AppToaster(): ReactElement {
  const { theme } = useTheme();
  return <Toaster theme={theme} />;
}
