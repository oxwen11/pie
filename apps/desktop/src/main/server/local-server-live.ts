import fs from "node:fs";
import path from "node:path";

import { Effect, Layer } from "effect";
import { ChildProcessSpawner } from "effect/unstable/process";

import { applyPackagedPiRuntime, DesktopConfig } from "../desktop-config";
import { makeDaemonServerProcess } from "./daemon-server-process";
import { LocalServer, makeLocalServer } from "./local-server";
import { resolveLoginShellEnvironmentWith } from "./login-shell-environment";

const existingFile = (pathname: string): string | undefined =>
  fs.existsSync(pathname) ? pathname : undefined;

export const LocalServerLive = Layer.effect(
  LocalServer,
  Effect.gen(function* () {
    const config = yield* DesktopConfig;
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const environment = (
      config.isPackaged
        ? resolveLoginShellEnvironmentWith(spawner)
        : Effect.sync(() => ({ ...process.env }))
    ).pipe(
      Effect.map((env) =>
        applyPackagedPiRuntime(env, {
          isPackaged: config.isPackaged,
          bundledBun: existingFile(
            path.join(
              config.resourcesPath,
              "vendor",
              "bun",
              process.platform === "win32" ? "bun.exe" : "bun",
            ),
          ),
          bundledPiProcess: existingFile(
            path.join(config.resourcesPath, "pi-process", "pi-process.js"),
          ),
        }),
      ),
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
