import fs from "node:fs";
import path from "node:path";

import {
  type DaemonCompatibilityKey,
  embeddedDaemonCompatibilityKey,
} from "@getpie/core/compatibility";
import {
  type DaemonHandle,
  type DaemonPlatform,
  healthy,
  pidAlive,
  resolveOrSpawnDaemon,
  resolvePieHome,
} from "@getpie/server/daemon";
import { Effect } from "effect";

import { ServerSpawnError, type ServerProcessExit, type SpawnServer } from "./local-server";

const DEFAULT_POLL_INTERVAL_MS = 2_000;
const MAX_HEALTH_MISSES = 3;

export type DaemonServerProcessOptions = {
  /** How often to probe the attached daemon's liveness. */
  readonly pollIntervalMs?: number;
  /** Test/composition override; production uses this Main build's embedded ID. */
  readonly requiredCompatibilityKey?: DaemonCompatibilityKey;
};

/**
 * The desktop daemon's process.execPath is reused for bundled Pi children.
 * Electron's main macOS bundle has regular activation policy, so those children
 * register as separate Dock applications. The adjacent Helper bundle is the
 * same Node-capable runtime with LSUIElement=true. Other platforms and plain
 * Node processes keep their current executable unchanged.
 */
export function resolveServerRuntimeExecutable(
  platform: NodeJS.Platform = process.platform,
  execPath: string = process.execPath,
): string {
  if (platform !== "darwin") return execPath;

  const macosDir = path.dirname(execPath);
  const contentsDir = path.dirname(macosDir);
  const appBundle = path.dirname(contentsDir);
  if (
    path.basename(macosDir) !== "MacOS" ||
    path.basename(contentsDir) !== "Contents" ||
    path.extname(appBundle) !== ".app"
  ) {
    return execPath;
  }

  const helperName = `${path.basename(execPath)} Helper`;
  return path.join(contentsDir, "Frameworks", `${helperName}.app`, "Contents", "MacOS", helperName);
}

export type DaemonRuntime = "bun" | "node";

/** `PIE_DAEMON_RUNTIME=bun` runs the daemon under Bun; anything else keeps Electron/Node. */
export function parseDaemonRuntime(value: string | undefined): DaemonRuntime {
  return value?.trim().toLowerCase() === "bun" ? "bun" : "node";
}

const existingFile = (pathname: string | undefined): string | undefined =>
  pathname !== undefined && fs.existsSync(pathname) ? pathname : undefined;

export type DaemonServerArgv = {
  readonly argv: readonly string[];
  readonly electronAsNode: boolean;
};

/**
 * Daemon argv. Default is the Electron helper as Node. `PIE_DAEMON_RUNTIME=bun`
 * uses `PIE_BUN` when that path exists, otherwise PATH `bun`.
 */
export function resolveDaemonServerArgv(
  env: NodeJS.ProcessEnv,
  entry: string,
  platform: NodeJS.Platform = process.platform,
  execPath: string = process.execPath,
): DaemonServerArgv {
  if (parseDaemonRuntime(env.PIE_DAEMON_RUNTIME) === "bun") {
    return {
      argv: [existingFile(env.PIE_BUN?.trim()) ?? "bun", entry],
      electronAsNode: false,
    };
  }
  return {
    argv: [resolveServerRuntimeExecutable(platform, execPath), entry],
    electronAsNode: true,
  };
}

/**
 * The daemon-backed `SpawnServer`: instead of forking a die-with-app child,
 * attach the daemon under `$PIE_HOME` via the shared launcher — the same
 * attach-or-spawn the CLI runs, so desktop and CLI with the same home
 * converge on one backend.
 * Consequences the supervisor inherits:
 *
 * - The daemon outlives the app: closing this process's scope kills nothing.
 * - "Exit" has no child handle to wait on, so it is detected by polling the
 *   recorded pid + `/api/health`; when the daemon dies, the supervisor loop
 *   re-runs this spawner, which re-spawns through the launcher (auto-heal).
 * - Respawn attempts (port !== 0) set `autoRespawn`, so an explicit
 *   `pie daemon stop` is respected: the launcher refuses to resurrect a
 *   tombstoned daemon and the supervisor surfaces "failed" instead. A fresh
 *   app launch (port === 0) is explicit intent and clears the tombstone.
 */
export function makeDaemonServerProcess(
  options: DaemonServerProcessOptions = {},
): Effect.Effect<SpawnServer, never, DaemonPlatform> {
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const requiredCompatibilityKey =
    options.requiredCompatibilityKey ?? embeddedDaemonCompatibilityKey();

  return Effect.gen(function* () {
    // The launcher's file state runs on the platform services; bind them once
    // here so the spawner still satisfies the supervisor's `SpawnServer` shape.
    const platform = yield* Effect.context<DaemonPlatform>();

    return (config, port) =>
      Effect.gen(function* () {
        const { argv, electronAsNode } = resolveDaemonServerArgv(config.environment, config.entry);
        const environment = { ...config.environment };
        if (electronAsNode) {
          environment.ELECTRON_RUN_AS_NODE = "1";
        } else {
          delete environment.ELECTRON_RUN_AS_NODE;
        }

        const handle = yield* resolveOrSpawnDaemon({
          home: resolvePieHome(config.environment),
          requiredCompatibilityKey,
          serverArgv: argv,
          // 0 means "no preference" on the first attempt; afterwards the
          // supervisor pins the port it saw, which we pass as preferred.
          port: port === 0 ? undefined : port,
          environment,
          autoRespawn: port !== 0,
        }).pipe(
          Effect.mapError(
            (cause) =>
              new ServerSpawnError({
                message: `Unable to attach or spawn the pie daemon: ${cause.message}`,
                cause,
              }),
          ),
        );

        const awaitExit: Effect.Effect<ServerProcessExit, ServerSpawnError> = Effect.gen(
          function* () {
            let misses = 0;
            while (true) {
              yield* Effect.sleep(pollIntervalMs);
              if (!pidAlive(handle.pid)) {
                yield* logLivenessFailed("process_missing", handle);
                return { exitCode: null };
              }
              // Tolerate transient probe failures; a wedged-but-alive daemon
              // still counts as dead after enough consecutive misses.
              if (yield* healthy(handle.address)) {
                misses = 0;
                continue;
              }
              misses += 1;
              yield* logLivenessFailed("unhealthy", handle, misses);
              if (misses >= MAX_HEALTH_MISSES) return { exitCode: null };
            }
          },
        );

        return {
          ready: Effect.succeed(endpointOf(handle)),
          awaitExit,
        };
      }).pipe(Effect.provide(platform));
  });
}

type DaemonEndpoint = {
  port: number;
  token: string;
};

function endpointOf(handle: DaemonHandle): DaemonEndpoint {
  return { port: handle.port, token: handle.token };
}

function logLivenessFailed(
  reason: "process_missing" | "unhealthy",
  handle: DaemonHandle,
  consecutiveMisses?: number,
) {
  return Effect.logWarning("Daemon liveness probe failed").pipe(
    Effect.annotateLogs({
      event: "server.liveness.failed",
      reason,
      pid: handle.pid,
      address: handle.address,
      ...(consecutiveMisses === undefined ? undefined : { consecutiveMisses }),
    }),
  );
}
