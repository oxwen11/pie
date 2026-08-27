import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { useEffect, useRef, type ReactElement, type ReactNode } from "react";
import { ErrorBoundary } from "react-error-boundary";
import { Toaster } from "sonner";

import "./index.css";

import { AppErrorPage } from "./components/app-error-page";
import { contentPanel } from "./content-panel";
import { ChatManager } from "./features/chat/runtime/chat-manager";
import { ChatManagerProvider } from "./features/chat/runtime/chat-manager-provider";
import { OrpcChatSessionTransport } from "./features/chat/runtime/chat-transport";
import { createTerminalPanel } from "./features/terminal/terminal-panel";
import { createAppClients } from "./lib/orpc";
import { usePlatform } from "./platform-context";
import { createRouter } from "./router";
import type { ServerConnection } from "./server-connection";
import { ThemeProvider, useTheme } from "./theme-provider";

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
    // Banner is a CSS-styled console.log with an inline SVG. Chromium's
    // ELECTRON_ENABLE_LOGGING dumps that as a multi-kilobyte TTY blob.
    const log = console.log.bind(console);
    console.log = (...args: unknown[]) => {
      if (typeof args[0] === "string" && args[0].includes("%cReact Grab")) return;
      log(...args);
    };
    try {
      init({ telemetry: false });
    } finally {
      console.log = log;
    }
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
export function AppInterface({ server }: { server?: ServerConnection }): ReactElement {
  return (
    <ErrorBoundary FallbackComponent={AppErrorPage}>
      <AppHost server={server} />
    </ErrorBoundary>
  );
}

function AppHost({ server }: { server?: ServerConnection }): ReactElement {
  usePlatform();
  // Daemon respawn mints a new ticket token. Keep clients tied to that identity
  // so getTicket cannot keep posting the previous Bearer.
  const identity = server ? `${server.httpBaseUrl}\0${server.token}` : "default";
  return <AppRuntime key={identity} server={server} />;
}

/** Explicit stable application dependencies, with no host knowledge. */
function AppRuntime({ server }: { server?: ServerConnection }): ReactElement {
  const clients = useStable(() => createAppClients(server));
  const { orpcClient, queryClient, orpcQueryUtils } = clients;
  const router = useStable(() => createRouter({ orpcClient, queryClient, orpcQueryUtils }));
  useEffect(() => contentPanel.register(createTerminalPanel(orpcClient)), [orpcClient]);
  // Composition root: the only place that knows Chat's wire transport is oRPC.
  const chatManager = useStable(
    () => new ChatManager((ref) => new OrpcChatSessionTransport(orpcClient.agent, ref)),
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
