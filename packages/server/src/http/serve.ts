import { Cause, Context, Effect, Option, Redacted, Scope } from "effect";
import { Command, Flag } from "effect/unstable/cli";

import {
  npmPackageVersion,
  optionString,
  pieAllowedHosts,
  pieAuthToken,
  pieCorsOrigins,
  pieDaemonCompatibilityKey,
  piePort,
  nodeEnv,
} from "../config/env";
import { PathsLayer } from "../config/paths";
import * as Observability from "../observability";
import { formatReadyLine } from "./handshake";
import { listenServer } from "./listen";
import { createServer, ServerStartupError } from "./server";

const DEFAULT_PORT = 4000;

export const serveFlags = {
  port: Flag.integer("port").pipe(
    Flag.withDescription("Port to listen on (overrides PIE_PORT)"),
    Flag.optional,
  ),
  corsOrigin: Flag.string("cors-origin").pipe(
    Flag.withDescription("Origin allowed to make cross-origin requests; repeatable"),
    Flag.atLeast(0),
  ),
  allowedHost: Flag.string("allowed-host").pipe(
    Flag.withDescription(
      "Extra Host header accepted besides loopback, for a trusted reverse proxy; repeatable",
    ),
    Flag.atLeast(0),
  ),
};

type ServeInput = {
  readonly port: Option.Option<number>;
  readonly corsOrigin: ReadonlyArray<string>;
  readonly allowedHost: ReadonlyArray<string>;
};

export type ServeConfig = {
  readonly port: number;
  readonly corsOrigins: readonly string[];
  readonly allowedHosts: readonly string[];
};

/**
 * Resolve the effective port and CORS origins from parsed flags, falling back
 * to `PIE_*` config and finally the defaults — precedence flag > config > default.
 */
export const resolveServeConfig = (input: ServeInput) =>
  Effect.gen(function* () {
    const envPort = yield* piePort;
    const envName = yield* nodeEnv;
    const corsFromEnv = yield* pieCorsOrigins;
    const hostsFromEnv = yield* pieAllowedHosts;
    const defaultPort = envName === "development" ? 0 : DEFAULT_PORT;
    return {
      port: Option.getOrElse(input.port, () => Option.getOrElse(envPort, () => defaultPort)),
      corsOrigins: input.corsOrigin.length > 0 ? input.corsOrigin : corsFromEnv,
      allowedHosts: input.allowedHost.length > 0 ? input.allowedHost : hostsFromEnv,
    };
  });

/**
 * Boot the HTTP server and keep the process alive until interrupted.
 * The auth token is env-only. The server is acquired in the ambient scope so
 * `NodeRuntime.runMain`'s SIGINT/SIGTERM interrupt tears it down through the
 * release finalizer.
 *
 * This is the process composition root for observability. The layer is
 * provided once around the complete server lifecycle, so foreground and
 * daemon runs share the same local logger. FileSystem and Crypto stay on
 * the outer `NodeServices.layer`; Paths is provided here so the log
 * directory is the same `logsDir` the rest of the process uses.
 *
 * `createServer` is Promise-shaped, so `serveWith` captures the process
 * context (logger included) and `createRpcRuntime` `provideMerge`s it into
 * `AgentRuntimeLayer`. That merge must stay `provideMerge`, not `mergeAll`:
 * fibers forked while the graph is building would otherwise capture Effect's
 * default logger.
 */
export const runServe = (input: ServeInput) =>
  serveWith(input).pipe(
    Effect.onInterrupt(() =>
      Effect.logWarning("server interrupted").pipe(
        Effect.annotateLogs({ event: "server.interrupted", pid: process.pid }),
      ),
    ),
    Effect.tapError((error) =>
      Effect.logError("server startup failed", Cause.fail(error)).pipe(
        Effect.annotateLogs({
          event: "server.startup_failed",
          phase: error.phase,
          pid: process.pid,
        }),
      ),
    ),
    Effect.provide(Observability.layer()),
    Effect.provide(PathsLayer),
  );

const serveWith = (input: ServeInput) =>
  Effect.gen(function* () {
    const token = yield* pieAuthToken;
    const authToken = Option.match(token, {
      onNone: () => undefined,
      onSome: Redacted.value,
    });
    const { port: requestedPort, corsOrigins, allowedHosts } = yield* resolveServeConfig(input);
    const compatibilityKey = optionString(yield* pieDaemonCompatibilityKey);
    const version = optionString(yield* npmPackageVersion);

    // The first line of every run, and the one that dates the file. It also
    // records the shape of the run — auth on or off, which origins are allowed
    // — because a misconfiguration explains failures that otherwise look like
    // the client's fault.
    yield* Effect.logInfo("server starting").pipe(
      Effect.annotateLogs({
        event: "server.starting",
        requestedPort,
        authenticated: authToken !== undefined,
        compatibilityKey,
        corsOrigins,
        allowedHosts,
        pid: process.pid,
        version,
        node: process.version,
      }),
    );

    const effectContext = Context.omit(Scope.Scope)(yield* Effect.context());
    const server = yield* Effect.acquireRelease(
      Effect.tryPromise({
        try: () =>
          createServer({
            authToken,
            corsOrigins,
            allowedHosts,
            effectContext,
            shutdown:
              authToken === undefined
                ? undefined
                : () => setImmediate(() => process.kill(process.pid, "SIGTERM")),
          }),
        catch: (cause) => new ServerStartupError({ phase: "create", cause }),
      }),
      // A shutdown failure is logged, not thrown: the process is exiting, and
      // a defect here would mask whatever caused the exit in the first place.
      //
      // The clean stop is logged too: a log that ends without it ended in a
      // kill -9, an OOM, or a crash, and knowing which is the first question
      // when reading back a run that stopped for no visible reason.
      (managed) =>
        Effect.tryPromise(() => managed.dispose()).pipe(
          Effect.andThen(
            Effect.logInfo("server stopped").pipe(
              Effect.annotateLogs({ event: "server.stopped", pid: process.pid }),
            ),
          ),
          Effect.catch((error) =>
            Effect.logWarning("server shutdown failed", error).pipe(
              Effect.annotateLogs({ event: "server.shutdown_failed", pid: process.pid }),
            ),
          ),
        ),
    );

    const port = yield* Effect.tryPromise({
      try: () => listenServer(server, requestedPort),
      catch: (cause) => new ServerStartupError({ phase: "listen", cause }),
    });

    // Machine-readable first, for the desktop supervisor; human-readable
    // second. Both go to stdout; observability writes to the local log file and
    // only mirrors to stderr when `PIE_PRINT_LOGS=1`.
    console.log(formatReadyLine({ port }));
    console.log(`pie listening on http://127.0.0.1:${port}`);

    yield* Effect.logInfo("server listening").pipe(
      Effect.annotateLogs({ event: "server.listening", pid: process.pid, port }),
    );

    return yield* Effect.never;
  });

export const serve = Command.make("serve", serveFlags, runServe).pipe(
  Command.withDescription("Start the pie local server"),
);
