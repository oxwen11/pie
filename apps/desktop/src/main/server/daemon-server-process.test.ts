import assert from "node:assert/strict";
import path from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { layer } from "@effect/vitest";
import { readRecord, stopDaemon } from "@getpie/server/daemon";
import * as Observability from "@getpie/server/observability";
import { Deferred, Effect, FileSystem } from "effect";

import { makeDaemonServerProcess } from "./daemon-server-process";
import { type ServerProcessConfig, type SpawnServer, makeLocalServer } from "./local-server";

// A minimal daemon body: binds PIE_PORT and answers /api/health, which is
// all the launcher's readiness and the spawner's liveness poll observe.
const FAKE_SERVER = `
import fs from "node:fs";
import http from "node:http";
const server = http.createServer((req, res) => {
  if (req.method === "GET" && req.url === "/api/health") {
    if (process.env.PIE_TEST_WEDGE_FILE && fs.existsSync(process.env.PIE_TEST_WEDGE_FILE)) return;
    return res.end("ok");
  }
  res.statusCode = 404;
  res.end();
});
server.listen(Number(process.env.PIE_PORT ?? 0), "127.0.0.1");
`;

// The launcher's file state runs on the platform services; the real ones here,
// exactly as the desktop runtime provides them. `excludeTestServices` because
// readiness and liveness poll on a real clock, which the default TestClock
// never advances.
layer(NodeServices.layer, { excludeTestServices: true, timeout: "30 seconds" })(
  "DaemonServerProcess",
  (it) => {
    /**
     * A temp `$PIE_HOME` holding the fake server's entry point. Finalizers
     * run LIFO, so the daemon is stopped before the directory holding its
     * record goes away — on the failure path too.
     */
    const workspace = Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const home = yield* fs.makeTempDirectoryScoped({ prefix: "pie-daemon-desktop-" });
      const daemonDir = path.join(home, "isolated-daemon");
      const entry = path.join(home, "fake-server.mjs");
      const wedgeFile = path.join(home, "wedge-health");
      yield* fs.writeFileString(entry, FAKE_SERVER);
      yield* Effect.addFinalizer(() => Effect.ignore(stopDaemon(daemonDir)));
      const config: ServerProcessConfig = {
        entry,
        environment: {
          ...process.env,
          PIE_HOME: home,
          PIE_DAEMON_DIR: daemonDir,
          PIE_TEST_WEDGE_FILE: wedgeFile,
        },
      };
      return { daemonDir, config, home, wedgeFile };
    });

    it.effect("spawns the shared daemon and reports its endpoint, then attaches on respawn", () =>
      Effect.gen(function* () {
        const { daemonDir, config } = yield* workspace;

        const endpoint = yield* Effect.scoped(
          Effect.gen(function* () {
            const spawn = yield* makeDaemonServerProcess({ pollIntervalMs: 100 });
            const running = yield* spawn(config, 0);
            return yield* running.ready;
          }),
        );

        const record = yield* readRecord(daemonDir);
        assert.ok(record);
        // The endpoint carries the daemon's own minted token, read from the record.
        assert.deepEqual(endpoint, {
          port: Number(new URL(record.address).port),
          token: record.token,
          pid: record.pid,
          address: record.address,
          reused: false,
        });

        const again = yield* Effect.scoped(
          Effect.gen(function* () {
            const spawn = yield* makeDaemonServerProcess({ pollIntervalMs: 100 });
            const running = yield* spawn(config, endpoint.port);
            return yield* running.ready;
          }),
        );
        assert.deepEqual(again, { ...endpoint, reused: true });
        assert.equal((yield* readRecord(daemonDir))?.pid, record.pid);
      }),
    );

    it.effect("resolves awaitExit when the daemon dies", () =>
      Effect.gen(function* () {
        const { daemonDir, config } = yield* workspace;

        let expected:
          | {
              readonly pid: number;
              readonly address: string;
              readonly port: number;
            }
          | undefined;
        const exit = yield* Effect.scoped(
          Effect.gen(function* () {
            const spawn = yield* makeDaemonServerProcess({ pollIntervalMs: 50 });
            const running = yield* spawn(config, 0);
            yield* running.ready;
            const record = yield* readRecord(daemonDir);
            assert.ok(record);
            expected = {
              pid: record.pid,
              address: record.address,
              port: Number(new URL(record.address).port),
            };
            yield* stopDaemon(daemonDir);
            return yield* running.awaitExit;
          }),
        );

        assert.ok(expected);
        assert.deepEqual(exit, {
          exitCode: null,
          reason: "process_missing",
          ...expected,
          consecutiveMisses: 1,
        });
      }),
    );

    it.effect("distinguishes a live pid whose health probe repeatedly times out", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const { daemonDir, config, wedgeFile } = yield* workspace;

        const exit = yield* Effect.scoped(
          Effect.gen(function* () {
            const spawn = yield* makeDaemonServerProcess({
              pollIntervalMs: 20,
              healthTimeoutMs: 50,
            });
            const running = yield* spawn(config, 0);
            yield* running.ready;
            const record = yield* readRecord(daemonDir);
            assert.ok(record);
            yield* fs.writeFileString(wedgeFile, "wedged");
            return yield* running.awaitExit;
          }),
        );

        assert.equal(exit.reason, "health_timeout");
        assert.equal(exit.consecutiveMisses, 3);
        assert.equal(exit.pid, (yield* readRecord(daemonDir))?.pid);
        assert.equal(exit.address, (yield* readRecord(daemonDir))?.address);
        assert.ok((exit.probeDurationMs ?? 0) >= 40);
        assert.match(exit.probeError ?? "", /TimeoutError/);
      }),
    );

    it.effect("persists Desktop supervisor transitions in the selected Pie home", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const { config, home } = yield* workspace;
        const exited = yield* Deferred.make<{
          readonly exitCode: number | null;
          readonly reason: "process_missing";
          readonly pid: number;
          readonly address: string;
          readonly port: number;
          readonly consecutiveMisses: number;
        }>();
        const spawn: SpawnServer = () =>
          Effect.succeed({
            ready: Effect.succeed({
              port: 45_678,
              token: "desktop-observability-secret",
              pid: 321,
              address: "http://127.0.0.1:45678",
              reused: true,
            }),
            awaitExit: Deferred.await(exited),
          });

        yield* Effect.scoped(
          Effect.gen(function* () {
            const server = yield* makeLocalServer(
              {
                entry: config.entry,
                environment: Effect.succeed(config.environment),
                initialRestartDelayMs: 10_000,
              },
              spawn,
            );
            yield* server.connection;
            yield* Deferred.succeed(exited, {
              exitCode: null,
              reason: "process_missing",
              pid: 321,
              address: "http://127.0.0.1:45678",
              port: 45_678,
              consecutiveMisses: 1,
            });
            while ((yield* server.snapshot).status !== "reconnecting") {
              yield* Effect.sleep(1);
            }
          }).pipe(Effect.provide(Observability.layerForHome(home))),
        );

        const content = yield* fs.readFileString(path.join(home, "logs", "pie.log"));
        assert.match(content, /event=server\.supervisor\.exit_detected/);
        assert.match(content, /event=server\.supervisor\.restart_scheduled/);
        assert.match(content, /previousPid=321/);
        assert.doesNotMatch(content, /desktop-observability-secret/);
      }),
    );
  },
);
