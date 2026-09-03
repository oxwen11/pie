import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { useState, type ReactElement } from "react";
import { Toaster } from "sonner";

import "./index.css";

import { ChatManager } from "./features/chat/runtime/chat-manager";
import { ChatManagerProvider } from "./features/chat/runtime/chat-manager-provider";
import { OrpcChatSessionTransport } from "./features/chat/runtime/chat-transport";
import { createAppClients } from "./lib/orpc";
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

/** Shared application entry. PlatformProvider is the host seam above it. */
export function AppInterface({ server }: { server?: ServerConnection }): ReactElement {
  usePlatform();
  // Daemon respawn mints a new ticket token. Keep clients tied to that identity
  // so getTicket cannot keep posting the previous Bearer.
  const identity = server ? `${server.httpBaseUrl}\0${server.token}` : "default";
  return <AppRuntime key={identity} server={server} />;
}

/** Explicit stable application dependencies, with no host knowledge. */
function AppRuntime({ server }: { server?: ServerConnection }): ReactElement {
  const [{ orpcClient, queryClient, orpcQueryUtils }] = useState(() => createAppClients(server));
  const [router] = useState(() => createRouter({ orpcClient, queryClient, orpcQueryUtils }));
  // Composition root: the only place that knows Chat's wire transport is oRPC.
  const [chatManager] = useState(
    () => new ChatManager((ref) => new OrpcChatSessionTransport(orpcClient.agent, ref)),
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
