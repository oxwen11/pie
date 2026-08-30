import {
  Clock,
  Context,
  Data,
  Deferred,
  Effect,
  Queue,
  Result,
  Scope,
  Stream,
  SubscriptionRef,
} from "effect";

import type { ServerStatus, ServerStatusSnapshot, WebSocketAccess } from "../../shared/desktop-rpc";

const DEFAULTS = {
  initialRestartDelayMs: 500,
  maxRestartDelayMs: 10_000,
  maxFastFailures: 5,
  stableAfterMs: 10_000,
};

export class ServerSpawnError extends Data.TaggedError("ServerSpawnError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class ServerReadyTimeout extends Data.TaggedError("ServerReadyTimeout")<{
  readonly timeoutMs: number;
  readonly message: string;
}> {}

export class ServerExitedBeforeReady extends Data.TaggedError("ServerExitedBeforeReady")<{
  readonly exitCode: number | null;
  readonly message: string;
}> {}

export type ServerStartError = ServerSpawnError | ServerReadyTimeout | ServerExitedBeforeReady;

export type ServerProcessConfig = {
  readonly entry: string;
  readonly environment: NodeJS.ProcessEnv;
};

export type ServerProcessExit = {
  readonly exitCode: number | null;
};

/**
 * What a ready backend hands the supervisor. The token is per-process: a
 * managed child echoes the token it was given, while the shared daemon mints
 * its own — so it must come from the ready signal, not the static config.
 */
export type ServerEndpoint = {
  readonly port: number;
  readonly token: string;
};

export type RunningServerProcess = {
  readonly ready: Effect.Effect<ServerEndpoint, ServerStartError>;
  readonly awaitExit: Effect.Effect<ServerProcessExit, ServerSpawnError>;
};

export class ServerAccessError extends Data.TaggedError("ServerAccessError")<{
  readonly message: string;
}> {}

export class ServerProtocolUnsupportedError extends Data.TaggedError(
  "ServerProtocolUnsupportedError",
)<{ readonly message: string }> {}

export type RequestWebSocketAccess = (
  endpoint: ServerEndpoint,
) => Effect.Effect<WebSocketAccess, ServerAccessError>;

export type RequestBrowserPairing = (
  endpoint: ServerEndpoint,
) => Effect.Effect<{ readonly url: string }, ServerAccessError | ServerProtocolUnsupportedError>;

export type SpawnServer = (
  config: ServerProcessConfig,
  port: number,
) => Effect.Effect<RunningServerProcess, ServerSpawnError, Scope.Scope>;

export type LocalServerConfig = Omit<ServerProcessConfig, "environment"> & {
  /** Resolved inside the supervisor fiber so it never delays window creation. */
  readonly environment: Effect.Effect<NodeJS.ProcessEnv>;
  readonly initialRestartDelayMs?: number;
  readonly maxRestartDelayMs?: number;
  readonly maxFastFailures?: number;
  readonly stableAfterMs?: number;
};

export class LocalServer extends Context.Service<
  LocalServer,
  {
    readonly ready: Effect.Effect<void>;
    readonly webSocketAccess: Effect.Effect<WebSocketAccess, ServerAccessError>;
    readonly browserPairing: Effect.Effect<
      { readonly url: string },
      ServerAccessError | ServerProtocolUnsupportedError
    >;
    readonly snapshot: Effect.Effect<ServerStatusSnapshot>;
    readonly changes: Stream.Stream<ServerStatusSnapshot>;
    readonly retry: Effect.Effect<void>;
  }
>()("desktop/LocalServer") {}

export function restartBackoff(
  failureCount: number,
  initialDelayMs = DEFAULTS.initialRestartDelayMs,
  maxDelayMs = DEFAULTS.maxRestartDelayMs,
): number {
  return Math.min(initialDelayMs * 2 ** (failureCount - 1), maxDelayMs);
}

function startErrorAnnotations(error: ServerStartError) {
  switch (error._tag) {
    case "ServerReadyTimeout":
      return { reason: "ready_timeout", timeoutMs: error.timeoutMs };
    case "ServerExitedBeforeReady":
      return { reason: "exited_before_ready", exitCode: error.exitCode };
    case "ServerSpawnError": {
      const tag =
        error.cause && typeof error.cause === "object" && "_tag" in error.cause
          ? error.cause._tag
          : undefined;
      const causeType =
        tag === "DaemonLaunchError" || tag === "DaemonStoppedError" ? tag : undefined;
      return {
        reason: "spawn_failed",
        ...(causeType === undefined ? undefined : { causeType }),
      };
    }
  }
}

// The supervise fiber is the only writer of statusRef, so get→set is
// race-free. Not SubscriptionRef.modify: v4's set/modify publish
// unconditionally, which would replay no-op snapshots to subscribers.
function setStatus(ref: SubscriptionRef.SubscriptionRef<ServerStatusSnapshot>, next: ServerStatus) {
  return Effect.gen(function* () {
    const current = yield* SubscriptionRef.get(ref);
    if (current.status !== next) {
      yield* SubscriptionRef.set(ref, {
        revision: current.revision + 1,
        status: next,
      });
    }
  });
}

export function makeLocalServer(
  config: LocalServerConfig,
  spawnServer: SpawnServer,
  requestWebSocketAccess: RequestWebSocketAccess,
  requestBrowserPairing: RequestBrowserPairing,
): Effect.Effect<LocalServer["Service"], never, Scope.Scope> {
  return Effect.gen(function* () {
    const statusRef = yield* SubscriptionRef.make<ServerStatusSnapshot>({
      revision: 0,
      status: "starting",
    });
    const retryQueue = yield* Queue.dropping<void>(1);
    const initial = yield* Deferred.make<ServerEndpoint>();
    // The daemon can come back with a fresh token (and, rarely, port) after a
    // restart. Keep the endpoint in Main and broker short-lived access from it.
    const latest = yield* SubscriptionRef.make<ServerEndpoint | undefined>(undefined);

    const initialDelay = config.initialRestartDelayMs ?? DEFAULTS.initialRestartDelayMs;
    const maxDelay = config.maxRestartDelayMs ?? DEFAULTS.maxRestartDelayMs;
    const maxFailures = config.maxFastFailures ?? DEFAULTS.maxFastFailures;
    const stableAfter = config.stableAfterMs ?? DEFAULTS.stableAfterMs;

    const supervise = Effect.gen(function* () {
      const processConfig: ServerProcessConfig = {
        entry: config.entry,
        environment: yield* config.environment,
      };
      let first = true;
      let pinnedPort = 0;
      let fastFailures = 0;

      while (true) {
        let readyAt: number | undefined;

        const attempt = yield* Effect.scoped(
          Effect.gen(function* () {
            const running = yield* spawnServer(processConfig, first ? 0 : pinnedPort);
            const endpoint = yield* running.ready;
            readyAt = yield* Clock.currentTimeMillis;

            const wasFirst = first;
            if (wasFirst) {
              pinnedPort = endpoint.port;
              first = false;
            }

            yield* SubscriptionRef.set(latest, endpoint);
            yield* setStatus(statusRef, "ready");
            if (wasFirst) yield* Deferred.succeed(initial, endpoint);
            return yield* running.awaitExit;
          }),
        ).pipe(Effect.result);

        if (Result.isFailure(attempt)) {
          yield* Effect.logWarning("Server process attempt failed").pipe(
            Effect.annotateLogs({
              event: "server.supervisor.attempt_failed",
              ...startErrorAnnotations(attempt.failure),
            }),
          );
        }

        if (first) {
          yield* Effect.logWarning("Server supervision paused after initial failure").pipe(
            Effect.annotateLogs({ event: "server.supervisor.failed" }),
          );
          yield* setStatus(statusRef, "failed");
          yield* Queue.take(retryQueue);
          yield* Effect.logInfo("Server retry requested").pipe(
            Effect.annotateLogs({ event: "server.supervisor.retry_requested" }),
          );
          yield* setStatus(statusRef, "starting");
          continue;
        }

        const now = yield* Clock.currentTimeMillis;
        const uptime = readyAt === undefined ? 0 : now - readyAt;
        if (uptime >= stableAfter) fastFailures = 0;
        fastFailures += 1;

        if (fastFailures > maxFailures) {
          yield* Effect.logWarning("Server supervision paused after repeated failures").pipe(
            Effect.annotateLogs({
              event: "server.supervisor.restart_paused",
              fastFailures,
              uptimeMs: uptime,
            }),
          );
          yield* setStatus(statusRef, "failed");
          yield* Queue.take(retryQueue);
          yield* Effect.logInfo("Server restart requested").pipe(
            Effect.annotateLogs({ event: "server.supervisor.retry_requested" }),
          );
          fastFailures = 0;
          yield* setStatus(statusRef, "reconnecting");
          continue;
        }

        const backoffMs = restartBackoff(fastFailures, initialDelay, maxDelay);
        yield* Effect.logWarning("Server restart scheduled").pipe(
          Effect.annotateLogs({
            event: "server.supervisor.restart_scheduled",
            backoffMs,
            fastFailures,
            uptimeMs: uptime,
          }),
        );
        yield* setStatus(statusRef, "reconnecting");
        yield* Effect.sleep(backoffMs);
      }
    });

    yield* supervise.pipe(Effect.forkScoped);
    const snapshot = SubscriptionRef.get(statusRef);

    const currentEndpoint = Effect.gen(function* () {
      const firstEndpoint = yield* Deferred.await(initial);
      return (yield* SubscriptionRef.get(latest)) ?? firstEndpoint;
    });

    return {
      ready: Deferred.await(initial).pipe(Effect.asVoid),
      webSocketAccess: currentEndpoint.pipe(Effect.flatMap(requestWebSocketAccess)),
      browserPairing: currentEndpoint.pipe(Effect.flatMap(requestBrowserPairing)),
      snapshot,
      changes: SubscriptionRef.changes(statusRef),
      retry: Effect.gen(function* () {
        const current = yield* snapshot;
        if (current.status === "failed") yield* Queue.offer(retryQueue, undefined);
      }),
    } satisfies LocalServer["Service"];
  });
}
