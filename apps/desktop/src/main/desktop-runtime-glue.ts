import { Effect, Layer } from "effect";
import { app } from "electron";

import { DesktopApplication, makeDesktopApplication } from "./application/desktop-application";
import { RendererChannel, makeRendererChannel } from "./electron/renderer-channel";
import { makeDesktopRpcServer } from "./rpc/desktop-rpc-server";
import { LocalServer } from "./server/local-server";
import { DesktopSsh, formatSshInput } from "./ssh/desktop-ssh";
import { DesktopTailscale } from "./tailscale/desktop-tailscale";

// These two Live layers need Electron capabilities (app.quit, and the oRPC
// MessagePort wiring that reaches into application/** and rpc/**) that the
// modules they connect are not allowed to import directly, so they live at
// the composition root instead of alongside their Tag. Split into their own
// file (rather than desktop-runtime.ts itself) so they stay importable from
// tests without pulling in main-window.ts's BrowserWindow dependency.
export const DesktopApplicationLive = Layer.effect(
  DesktopApplication,
  Effect.gen(function* () {
    const server = yield* LocalServer;
    const ssh = yield* DesktopSsh;
    const tailscale = yield* DesktopTailscale;
    const savedRemotes = yield* ssh.listSaved;
    const application = makeDesktopApplication({
      server,
      ssh,
      tailscale,
      quit: Effect.sync(() => {
        setTimeout(() => app.quit(), 0);
      }),
    });
    for (const remote of savedRemotes) {
      yield* application.connectSsh(formatSshInput(remote.target)).pipe(
        Effect.catch(() => Effect.void),
        Effect.forkScoped,
      );
    }
    return application;
  }),
);

export const RendererChannelLive = Layer.effect(
  RendererChannel,
  Effect.gen(function* () {
    const application = yield* DesktopApplication;
    // Hand the composition root's full ServiceMap (including logger and
    // other references) to the detached oRPC handler fibers.
    const rpcContext = yield* Effect.context();
    return makeRendererChannel(makeDesktopRpcServer(application, rpcContext).attach);
  }),
);
