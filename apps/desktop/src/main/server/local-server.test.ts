import { Context, Deferred, Effect, Exit, Logger, Scope } from "effect";
import { describe, expect, it } from "vitest";

import {
  ServerExitedBeforeReady,
  ServerSpawnError,
  type ServerEndpoint,
  type ServerProcessConfig,
  type LocalServerConfig,
  type RunningServerProcess,
  type SpawnServer,
  makeLocalServer,
  restartBackoff,
} from "./local-server";

type FakeProcess = {
  readonly port: number;
  readonly config: ServerProcessConfig;
  readonly becomeReady: (port?: number, token?: string) => void;
  readonly failBeforeReady: (message?: string) => void;
  readonly exit: () => void;
  killed: boolean;
};

function makeHarness(
  overrides: Partial<LocalServerConfig> = {},
  initialSpawnFailure?: ServerSpawnError,
) {
  const processes: FakeProcess[] = [];
  const logs: Array<{ readonly message: unknown; readonly annotations: Record<string, unknown> }> =
    [];
  const scope = Effect.runSync(Scope.make());
  const logContext = Context.empty().pipe(
    Context.add(
      Logger.CurrentLoggers,
      new Set([
        Logger.map(Logger.formatStructured, (output) => {
          logs.push({ message: output.message, annotations: output.annotations });
          return output;
        }),
      ]),
    ),
  ) as Context.Context<never>;

  const spawnServer: SpawnServer = (config, port) => {
    if (initialSpawnFailure && processes.length === 0) return Effect.fail(initialSpawnFailure);
    return Effect.gen(function* () {
      const ready = yield* Deferred.make<ServerEndpoint, ServerExitedBeforeReady>();
      const exited = yield* Deferred.make<{ exitCode: number | null }>();
      const process: FakeProcess = {
        port,
        config,
        killed: false,
        becomeReady: (boundPort = port || 40_000, token = "daemon-token") => {
          Effect.runSync(Deferred.succeed(ready, { port: boundPort, token }));
        },
        failBeforeReady: (message = "exited before ready") => {
          Effect.runSync(
            Deferred.fail(
              ready,
              new ServerExitedBeforeReady({
                exitCode: 1,
                message,
              }),
            ),
          );
        },
        exit: () => {
          Effect.runSync(Deferred.succeed(exited, { exitCode: 1 }));
        },
      };
      processes.push(process);
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          process.killed = true;
        }),
      );
      return {
        ready: Deferred.await(ready),
        awaitExit: Deferred.await(exited),
      } satisfies RunningServerProcess;
    });
  };

  const config: LocalServerConfig = {
    entry: "/fake/cli.mjs",
    environment: Effect.succeed({
      PATH: "/login/bin:/usr/bin",
      HTTPS_PROXY: "http://proxy.test:8443",
    }),
    initialRestartDelayMs: 0,
    maxRestartDelayMs: 0,
    maxFastFailures: 5,
    stableAfterMs: 10_000,
    ...overrides,
  };

  return {
    processes,
    logs,
    server: Effect.runPromise(
      makeLocalServer(config, spawnServer).pipe(Scope.provide(scope), Effect.provide(logContext)),
    ),
    dispose: () => Effect.runPromise(Scope.close(scope, Exit.void)),
  };
}

async function eventually(assertion: () => void | Promise<void>): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      await assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => {
        setTimeout(resolve, 0);
      });
    }
  }
  throw lastError;
}

describe("LocalServer", () => {
  it("returns while starting, then exposes the fixed connection after ready", async () => {
    const h = makeHarness();
    const server = await h.server;

    await expect(Effect.runPromise(server.snapshot)).resolves.toMatchObject({
      status: "starting",
    });
    await eventually(() => expect(h.processes[0]?.port).toBe(0));
    h.processes[0]!.becomeReady(56_789);

    await expect(Effect.runPromise(server.connection)).resolves.toEqual({
      httpBaseUrl: "http://127.0.0.1:56789",
      wsBaseUrl: "ws://127.0.0.1:56789",
      token: "daemon-token",
    });
    await expect(Effect.runPromise(server.snapshot)).resolves.toMatchObject({ status: "ready" });
    expect(h.processes[0]!.config.environment).toMatchObject({
      PATH: "/login/bin:/usr/bin",
      HTTPS_PROXY: "http://proxy.test:8443",
    });

    await h.dispose();
  });

  it("does not wait for environment resolution before exposing starting state", async () => {
    const environment = Effect.runSync(Deferred.make<NodeJS.ProcessEnv>());
    const h = makeHarness({ environment: Deferred.await(environment) });
    const server = await h.server;

    expect(h.processes).toHaveLength(0);
    await expect(Effect.runPromise(server.snapshot)).resolves.toMatchObject({
      status: "starting",
    });

    Effect.runSync(Deferred.succeed(environment, { PATH: "/usr/bin" }));
    await eventually(() => expect(h.processes).toHaveLength(1));
    h.processes[0]!.becomeReady(50_000);
    await Effect.runPromise(server.connection);
    await h.dispose();
  });

  it("classifies spawn failures without logging their message or cause", async () => {
    const h = makeHarness(
      {},
      new ServerSpawnError({
        message: "spawn failed with sentinel-spawn-token",
        cause: { _tag: "UntrustedFailure", token: "sentinel-cause-token" },
      }),
    );
    const server = await h.server;

    await eventually(async () => {
      const snapshot = await Effect.runPromise(server.snapshot);
      expect(snapshot.status).toBe("failed");
    });
    expect(
      h.logs.find((entry) => entry.annotations.event === "server.supervisor.attempt_failed"),
    ).toMatchObject({
      annotations: { reason: "spawn_failed" },
    });
    expect(JSON.stringify(h.logs)).not.toContain("sentinel-spawn-token");
    expect(JSON.stringify(h.logs)).not.toContain("sentinel-cause-token");

    await h.dispose();
  });

  it("surfaces an initial failure and retries without rebuilding the service", async () => {
    const h = makeHarness();
    const server = await h.server;

    await eventually(() => expect(h.processes).toHaveLength(1));
    h.processes[0]!.failBeforeReady("failed with token sentinel-secret-token");
    await eventually(async () => {
      const snapshot = await Effect.runPromise(server.snapshot);
      expect(snapshot.status).toBe("failed");
    });

    await Effect.runPromise(server.retry);
    await eventually(() => expect(h.processes).toHaveLength(2));
    expect(h.processes[1]!.port).toBe(0);
    h.processes[1]!.becomeReady(50_000);

    await expect(Effect.runPromise(server.connection)).resolves.toMatchObject({
      httpBaseUrl: "http://127.0.0.1:50000",
    });
    expect(JSON.stringify(h.logs)).not.toContain("sentinel-secret-token");
    await h.dispose();
  });

  it("serves the latest endpoint after a restart hands back a new token", async () => {
    const h = makeHarness();
    await eventually(() => expect(h.processes).toHaveLength(1));
    h.processes[0]!.becomeReady(50_000);
    const server = await h.server;
    await expect(Effect.runPromise(server.connection)).resolves.toMatchObject({
      token: "daemon-token",
    });

    // A daemon respawn mints a fresh token — the connection must not be stale.
    h.processes[0]!.exit();
    await eventually(() => expect(h.processes).toHaveLength(2));
    h.processes[1]!.becomeReady(50_001, "rotated-token");
    await eventually(async () => {
      await expect(Effect.runPromise(server.connection)).resolves.toEqual({
        httpBaseUrl: "http://127.0.0.1:50001",
        wsBaseUrl: "ws://127.0.0.1:50001",
        token: "rotated-token",
      });
    });

    await h.dispose();
  });

  it("logs the restart decision without exposing daemon tokens", async () => {
    const h = makeHarness();
    await eventually(() => expect(h.processes).toHaveLength(1));
    h.processes[0]!.becomeReady(50_000, "first-secret");
    const server = await h.server;
    await Effect.runPromise(server.connection);

    h.processes[0]!.exit();
    await eventually(() => expect(h.processes).toHaveLength(2));
    h.processes[1]!.becomeReady(50_001, "replacement-secret");
    await eventually(async () => {
      await expect(Effect.runPromise(server.connection)).resolves.toMatchObject({
        httpBaseUrl: "http://127.0.0.1:50001",
      });
    });

    expect(
      h.logs.find((entry) => entry.annotations.event === "server.supervisor.restart_scheduled")
        ?.annotations,
    ).toMatchObject({
      backoffMs: 0,
      fastFailures: 1,
    });
    expect(JSON.stringify(h.logs)).not.toContain("first-secret");
    expect(JSON.stringify(h.logs)).not.toContain("replacement-secret");

    await h.dispose();
  });

  it("restarts on the same pinned port", async () => {
    const h = makeHarness();
    await eventually(() => expect(h.processes).toHaveLength(1));
    h.processes[0]!.becomeReady(50_000);
    const server = await h.server;
    await Effect.runPromise(server.connection);

    h.processes[0]!.exit();
    await eventually(() => expect(h.processes).toHaveLength(2));
    expect(h.processes[1]!.port).toBe(50_000);
    h.processes[1]!.becomeReady();
    await eventually(async () => {
      const snapshot = await Effect.runPromise(server.snapshot);
      expect(snapshot.status).toBe("ready");
    });

    await h.dispose();
  });

  it("enters failed after repeated crashes and retries only once", async () => {
    const h = makeHarness({ maxFastFailures: 2 });
    await eventually(() => expect(h.processes).toHaveLength(1));
    h.processes[0]!.becomeReady(50_000);
    const server = await h.server;
    await Effect.runPromise(server.connection);

    h.processes[0]!.exit();
    await eventually(() => expect(h.processes).toHaveLength(2));
    h.processes[1]!.failBeforeReady();
    await eventually(() => expect(h.processes).toHaveLength(3));
    h.processes[2]!.failBeforeReady();
    await eventually(async () => {
      const snapshot = await Effect.runPromise(server.snapshot);
      expect(snapshot.status).toBe("failed");
    });

    await Promise.all([
      Effect.runPromise(server.retry),
      Effect.runPromise(server.retry),
      Effect.runPromise(server.retry),
    ]);
    await eventually(() => expect(h.processes).toHaveLength(4));
    expect(h.processes[3]!.port).toBe(50_000);
    h.processes[3]!.becomeReady();
    await eventually(async () => {
      const snapshot = await Effect.runPromise(server.snapshot);
      expect(snapshot.status).toBe("ready");
    });

    await h.dispose();
  });

  it("kills the current process when its scope closes", async () => {
    const h = makeHarness();
    await eventually(() => expect(h.processes).toHaveLength(1));
    h.processes[0]!.becomeReady(50_000);
    const server = await h.server;
    await Effect.runPromise(server.connection);

    await h.dispose();

    expect(h.processes[0]!.killed).toBe(true);
  });
});

describe("restartBackoff", () => {
  it("doubles and caps", () => {
    expect([1, 2, 3, 4, 5, 6].map((n) => restartBackoff(n, 500, 10_000))).toEqual([
      500, 1000, 2000, 4000, 8000, 10_000,
    ]);
  });
});
