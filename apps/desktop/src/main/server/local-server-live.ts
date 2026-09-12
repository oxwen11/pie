import fs from "node:fs";
import path from "node:path";

import { resolveDevelopmentScope } from "@getpie/core/development-scope";
import { developmentDaemonEnvironment } from "@getpie/server/daemon";
import { Effect, FileSystem, Layer } from "effect";
import { ChildProcessSpawner } from "effect/unstable/process";

import { applyDesktopRuntime, DesktopConfig } from "../desktop-config";
import { withTailscaleAllowedHosts } from "../tailscale/allowed-hosts";
import { makeDaemonServerProcess } from "./daemon-server-process";
import { LocalServer, makeLocalServer } from "./local-server";
import { LoginShellEnvironment } from "./login-shell-environment";

const existingFile = (pathname: string): string | undefined =>
  fs.existsSync(pathname) ? pathname : undefined;

export const LocalServerLive = Layer.effect(
  LocalServer,
  Effect.gen(function* () {
    const config = yield* DesktopConfig;
    const loginShell = yield* LoginShellEnvironment;
    const platform = yield* Effect.context<
      FileSystem.FileSystem | ChildProcessSpawner.ChildProcessSpawner
    >();
    const environment = (
      config.isPackaged
        ? Effect.succeed(loginShell.env)
        : Effect.sync(() =>
            developmentDaemonEnvironment({ ...loginShell.env }, resolveDevelopmentScope()),
          )
    ).pipe(
      Effect.map((env) =>
        applyDesktopRuntime(env, {
          isPackaged: config.isPackaged,
          bundledBun: existingFile(
            path.join(
              config.resourcesPath,
              "vendor",
              process.platform === "win32" ? "bun.exe" : "bun",
            ),
          ),
        }),
      ),
      Effect.flatMap(withTailscaleAllowedHosts),
      Effect.provide(platform),
    );

    // Attach the daemon selected by PIE_HOME (the same one the CLI uses)
    // instead of forking a private die-with-app child.
    return yield* makeLocalServer(
      {
        entry: config.serverEntry,
        environment,
      },
      yield* makeDaemonServerProcess(),
    );
  }),
);
