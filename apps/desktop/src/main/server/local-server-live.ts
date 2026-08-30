import { issueDaemonBrowserPairing, issueDaemonWebSocketAccess } from "@getpie/server/daemon";
import { Effect, Layer } from "effect";
import { ChildProcessSpawner } from "effect/unstable/process";

import { DesktopConfig } from "../desktop-config";
import { makeDaemonServerProcess } from "./daemon-server-process";
import {
  LocalServer,
  makeLocalServer,
  ServerAccessError,
  ServerProtocolUnsupportedError,
} from "./local-server";
import { resolveLoginShellEnvironmentWith } from "./login-shell-environment";

export const LocalServerLive = Layer.effect(
  LocalServer,
  Effect.gen(function* () {
    const config = yield* DesktopConfig;
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const environment = config.isPackaged
      ? resolveLoginShellEnvironmentWith(spawner)
      : Effect.sync(() => ({ ...process.env }));

    // Attach the daemon selected by PIE_DAEMON_DIR (the same one the CLI
    // uses) instead of forking a private die-with-app child.
    return yield* makeLocalServer(
      {
        entry: config.serverEntry,
        environment,
      },
      yield* makeDaemonServerProcess(),
      (endpoint) =>
        issueDaemonWebSocketAccess({
          address: `http://127.0.0.1:${endpoint.port}`,
          token: endpoint.token,
        }).pipe(
          Effect.mapError(
            () => new ServerAccessError({ message: "Unable to obtain WebSocket access" }),
          ),
        ),
      (endpoint) =>
        issueDaemonBrowserPairing({
          address: `http://127.0.0.1:${endpoint.port}`,
          token: endpoint.token,
        }).pipe(
          Effect.map(({ url }) => ({ url })),
          Effect.mapError((error) =>
            error._tag === "DaemonProtocolUnsupportedError"
              ? new ServerProtocolUnsupportedError({
                  message: "The running daemon must be restarted for browser access",
                })
              : new ServerAccessError({ message: "Unable to obtain browser access" }),
          ),
        ),
    );
  }),
);
