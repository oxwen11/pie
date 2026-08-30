import assert from "node:assert/strict";
import childProcess from "node:child_process";
import path from "node:path";
import url from "node:url";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { layer } from "@effect/vitest";
import { makeGitHashDaemonCompatibilityKey } from "@getpie/core/compatibility";
import { Deferred, Effect, Fiber, FileSystem } from "effect";

import { resolveDaemonLocation } from "../../src/config/paths";
import { DaemonStoppedError } from "../../src/daemon/errors";
import {
  type ResolveDaemonOptions,
  resolveOrSpawnDaemon,
  statusDaemon,
  stopDaemon,
} from "../../src/daemon/launcher";
import { pidAlive } from "../../src/daemon/liveness";
import { readRecord, writeRecord } from "../../src/daemon/record";
import * as Observability from "../../src/observability";

const FAKE_SERVER = url.fileURLToPath(new URL("./fixtures/fake-server.mjs", import.meta.url));

// The daemon = this argv spawned detached. Point it at the fake server so the
// launcher's attach-or-spawn/health/record orchestration is exercised without
// booting the real runtime.
const serverArgv = [process.execPath, FAKE_SERVER];
const TEST_KEY = makeGitHashDaemonCompatibilityKey("aaaaaaaa");
const NEXT_KEY = makeGitHashDaemonCompatibilityKey("bbbbbbbb");

const resolve = (
  options: Omit<ResolveDaemonOptions, "serverArgv" | "requiredCompatibilityKey"> & {
    readonly requiredCompatibilityKey?: ResolveDaemonOptions["requiredCompatibilityKey"];
  },
) =>
  resolveOrSpawnDaemon({
    serverArgv,
    requiredCompatibilityKey: TEST_KEY,
    ...options,
  });

// `excludeTestServices` because the launcher polls a real daemon's health on a
// real clock: under the default TestClock its retry schedule never advances.
// The timeout covers a spawn + readiness handshake, not a unit assertion.
layer(NodeServices.layer, { excludeTestServices: true, timeout: "30 seconds" })(
  "resolveOrSpawnDaemon",
  (it) => {
    /**
     * A temp `$PIE_HOME` and the pair a front door would resolve for it —
     * through the real resolver, so these tests never restate where the default
     * daemon directory is (`test/paths.test.ts` owns that). Bound to the test's
     * scope, and finalizers run LIFO, so the daemon is stopped before the
     * directory holding its record goes away — however the test ends, which is
     * what the old `afterEach` could only do on the happy path.
     */
    const tempHome = Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const home = yield* fs.makeTempDirectoryScoped({ prefix: "pie-daemon-" });
      const location = resolveDaemonLocation({ PIE_HOME: home });
      yield* Effect.addFinalizer(() => Effect.ignore(stopDaemon(location.daemonDir)));
      return location;
    });

    it.effect("spawns a daemon, records it, then attaches on the next call", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const { home, daemonDir } = yield* tempHome;
        const spawned = yield* resolve({ home, daemonDir, port: 0, readyTimeoutMs: 15_000 });
        assert.equal(spawned.reused, false);
        assert.match(spawned.address, /^http:\/\/127\.0\.0\.1:\d+$/);
        assert.ok(pidAlive(spawned.pid));
        // Stdio lands with the rest of the logging, not in the daemon
        // directory — that holds lifecycle state only.
        assert.ok(yield* fs.exists(path.join(home, "logs", "daemon-stdio.log")));
        assert.equal(yield* fs.exists(path.join(daemonDir, "daemon.log")), false);
        // Asserted *here*, on a real launch, and not only where the batched
        // sink is unit-tested: the launcher creates `logs/` before the daemon
        // it is spawning exists, so it is the one whose mode decides on a fresh
        // install. Testing the sink alone passes while the daemon path leaves
        // the directory world-readable.
        const logs = yield* fs.stat(path.join(home, "logs"));
        const stdio = yield* fs.stat(path.join(home, "logs", "daemon-stdio.log"));
        assert.equal(((logs.mode ?? 0) & 0o777).toString(8), "700");
        assert.equal(((stdio.mode ?? 0) & 0o777).toString(8), "600");

        const record = yield* readRecord(daemonDir);
        assert.equal(record?.pid, spawned.pid);
        assert.equal(record?.address, spawned.address);
        assert.equal(record?.token, spawned.token);
        assert.equal(record?.compatibilityKey, TEST_KEY);

        const attached = yield* resolve({ home, daemonDir, port: 0 });
        assert.equal(attached.reused, true);
        assert.equal(attached.pid, spawned.pid);
        assert.equal(attached.address, spawned.address);
      }),
    );

    it.effect("isolates lifecycle state in an explicit daemon directory", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const { home, daemonDir: defaultDir } = yield* tempHome;
        const daemonDir = path.join(home, "isolated-daemon");
        yield* Effect.addFinalizer(() => Effect.ignore(stopDaemon(daemonDir)));

        const spawned = yield* resolve({
          home,
          daemonDir,
          port: 0,
          readyTimeoutMs: 15_000,
        });
        assert.equal((yield* readRecord(daemonDir))?.pid, spawned.pid);
        // Nothing leaks into the default directory, nor into `$PIE_HOME`.
        assert.equal(yield* readRecord(defaultDir), undefined);
        for (const file of ["daemon.pid", "daemon.lock", "daemon.stopped"]) {
          assert.equal(yield* fs.exists(path.join(home, file)), false);
          assert.equal(yield* fs.exists(path.join(defaultDir, file)), false);
        }
        // Logging is deliberately NOT isolated per daemon directory: one
        // `$PIE_HOME` means one place to read, and every line carries the
        // `pid` that wrote it.
        assert.ok(yield* fs.exists(path.join(home, "logs", "daemon-stdio.log")));

        assert.equal(yield* stopDaemon(daemonDir), "stopped");
        assert.ok(yield* fs.exists(path.join(daemonDir, "daemon.stopped")));
        assert.equal(yield* fs.exists(path.join(home, "daemon.stopped")), false);
      }),
    );

    it.effect("replaces a healthy daemon with a different compatibility key exactly once", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const { home, daemonDir } = yield* tempHome;
        const first = yield* resolve({ home, daemonDir, port: 0, readyTimeoutMs: 15_000 });

        const replacement = yield* resolve({
          home,
          daemonDir,
          port: 0,
          readyTimeoutMs: 15_000,
          requiredCompatibilityKey: NEXT_KEY,
        }).pipe(Effect.provide(Observability.layerForHome(home)));
        assert.equal(replacement.reused, false);
        assert.notEqual(replacement.pid, first.pid);
        assert.equal(pidAlive(first.pid), false);
        assert.equal((yield* readRecord(daemonDir))?.compatibilityKey, NEXT_KEY);
        const log = yield* fs.readFileString(path.join(home, "logs", "pie.log"));
        assert.match(log, /event=daemon\.compatibility_mismatch/);
        assert.match(log, /actualCompatibilityKey=githash:aaaaaaaa/);
        assert.match(log, /requiredCompatibilityKey=githash:bbbbbbbb/);
        assert.match(log, /action=replace/);
        assert.doesNotMatch(log, new RegExp(first.token));

        const attached = yield* resolve({
          home,
          daemonDir,
          port: 0,
          requiredCompatibilityKey: NEXT_KEY,
        });
        assert.equal(attached.reused, true);
        assert.equal(attached.pid, replacement.pid);
      }),
    );

    it.effect("replaces a healthy legacy daemon whose record has no compatibility key", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const { home, daemonDir } = yield* tempHome;
        const first = yield* resolve({ home, daemonDir, port: 0, readyTimeoutMs: 15_000 });
        const record = yield* readRecord(daemonDir);
        assert.ok(record);
        const { compatibilityKey: _, ...legacyRecord } = record;
        yield* fs.writeFileString(path.join(daemonDir, "daemon.pid"), JSON.stringify(legacyRecord));

        const replacement = yield* resolve({
          home,
          daemonDir,
          port: 0,
          readyTimeoutMs: 15_000,
        });
        assert.equal(replacement.reused, false);
        assert.notEqual(replacement.pid, first.pid);
        assert.equal(pidAlive(first.pid), false);
      }),
    );

    it.effect("replaces a healthy daemon whose persisted compatibility key is malformed", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const { home, daemonDir } = yield* tempHome;
        const first = yield* resolve({ home, daemonDir, port: 0, readyTimeoutMs: 15_000 });
        const record = yield* readRecord(daemonDir);
        assert.ok(record);
        yield* fs.writeFileString(
          path.join(daemonDir, "daemon.pid"),
          JSON.stringify({ ...record, compatibilityKey: "protocol:0" }),
        );

        const replacement = yield* resolve({
          home,
          daemonDir,
          port: 0,
          readyTimeoutMs: 15_000,
        });
        assert.equal(replacement.reused, false);
        assert.notEqual(replacement.pid, first.pid);
        assert.equal(pidAlive(first.pid), false);
      }),
    );

    it.effect("reports status and stops the daemon", () =>
      Effect.gen(function* () {
        const { home, daemonDir } = yield* tempHome;
        const spawned = yield* resolve({ home, daemonDir, port: 0, readyTimeoutMs: 15_000 });

        const running = yield* statusDaemon(daemonDir);
        assert.equal(running.running, true);
        assert.equal(running.record?.pid, spawned.pid);

        assert.equal(yield* stopDaemon(daemonDir), "stopped");
        assert.equal(pidAlive(spawned.pid), false);
        assert.equal(yield* readRecord(daemonDir), undefined);
        assert.equal((yield* statusDaemon(daemonDir)).running, false);
      }),
    );

    it.effect("respawns when the recorded daemon is dead", () =>
      Effect.gen(function* () {
        const { home, daemonDir } = yield* tempHome;
        const first = yield* resolve({ home, daemonDir, port: 0, readyTimeoutMs: 15_000 });
        yield* stopDaemon(daemonDir);
        assert.equal(pidAlive(first.pid), false);

        const second = yield* resolve({ home, daemonDir, port: 0, readyTimeoutMs: 15_000 });
        assert.equal(second.reused, false);
        assert.notEqual(second.pid, first.pid);
        assert.ok(pidAlive(second.pid));
      }),
    );

    it.effect("reports not-running when stopping with no daemon", () =>
      Effect.gen(function* () {
        const { daemonDir } = yield* tempHome;
        assert.equal(yield* stopDaemon(daemonDir), "not-running");
      }),
    );

    it.effect("respawns after a crash that left the record behind", () =>
      Effect.gen(function* () {
        const { home, daemonDir } = yield* tempHome;
        const first = yield* resolve({ home, daemonDir, port: 0, readyTimeoutMs: 15_000 });

        // Simulate a crash: kill the process without stopDaemon, so the stale
        // record (pid dead) stays and must be replaced, not attached to.
        process.kill(first.pid, "SIGKILL");
        yield* Effect.sleep("20 millis").pipe(Effect.repeat({ while: () => pidAlive(first.pid) }));

        const second = yield* resolve({ home, daemonDir, port: 0, readyTimeoutMs: 15_000 });
        assert.equal(second.reused, false);
        assert.notEqual(second.pid, first.pid);
        assert.ok(pidAlive(second.pid));
      }),
    );

    it.effect("kills the daemon and removes its record when it never becomes healthy", () =>
      Effect.gen(function* () {
        const { home, daemonDir } = yield* tempHome;
        // A process that stays alive but never answers health. The record is
        // written before the health wait (so a dying launcher cannot orphan an
        // undiscoverable daemon), which makes this cleanup the path that takes
        // it back out.
        const error = yield* Effect.flip(
          resolveOrSpawnDaemon({
            serverArgv: [process.execPath, "-e", "setInterval(() => {}, 1000)"],
            home,
            daemonDir,
            requiredCompatibilityKey: TEST_KEY,
            port: 0,
            readyTimeoutMs: 500,
          }),
        );
        assert.match(error.message, /did not become healthy/);
        assert.equal(yield* readRecord(daemonDir), undefined);
      }),
    );

    it.effect("does not signal an unauthenticated pid from a wedged record", () =>
      Effect.gen(function* () {
        const { home, daemonDir } = yield* tempHome;
        const wedged = childProcess.spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"]);
        const wedgedPid = wedged.pid!;
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            if (pidAlive(wedgedPid)) process.kill(wedgedPid, "SIGKILL");
          }),
        );
        yield* writeRecord(daemonDir, {
          pid: wedgedPid,
          address: "http://127.0.0.1:1",
          token: "stale",
          startedAt: 0,
        });

        const error = yield* Effect.flip(
          resolve({ home, daemonDir, port: 0, readyTimeoutMs: 15_000 }),
        );
        assert.match(error.message, /Refusing to replace/);
        assert.equal(pidAlive(wedgedPid), true);
        assert.equal((yield* readRecord(daemonDir))?.pid, wedgedPid);
      }),
    );

    it.effect("does not report stop success or forget an unauthenticated live daemon", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const { daemonDir } = yield* tempHome;
        const wedged = childProcess.spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"]);
        const wedgedPid = wedged.pid!;
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            if (pidAlive(wedgedPid)) process.kill(wedgedPid, "SIGKILL");
          }),
        );
        yield* writeRecord(daemonDir, {
          pid: wedgedPid,
          address: "http://127.0.0.1:1",
          token: "stale",
          startedAt: 0,
        });

        const error = yield* Effect.flip(stopDaemon(daemonDir));
        assert.match(error.message, /Refusing to forget/);
        assert.equal(pidAlive(wedgedPid), true);
        assert.equal((yield* readRecord(daemonDir))?.pid, wedgedPid);
        assert.equal(yield* fs.exists(path.join(daemonDir, "daemon.stopped")), true);
      }),
    );

    it.effect("refuses to auto-respawn a daemon the user explicitly stopped", () =>
      Effect.gen(function* () {
        const { home, daemonDir } = yield* tempHome;
        const fs = yield* FileSystem.FileSystem;
        yield* resolve({ home, daemonDir, port: 0, readyTimeoutMs: 15_000 });
        yield* stopDaemon(daemonDir);
        assert.ok(yield* fs.exists(path.join(daemonDir, "daemon.stopped")));

        const error = yield* Effect.flip(resolve({ home, daemonDir, port: 0, autoRespawn: true }));
        assert.ok(error instanceof DaemonStoppedError);

        // An explicit start clears the tombstone; auto-respawn works again after.
        const restarted = yield* resolve({ home, daemonDir, port: 0, readyTimeoutMs: 15_000 });
        assert.equal(restarted.reused, false);
        const attached = yield* resolve({ home, daemonDir, port: 0, autoRespawn: true });
        assert.equal(attached.pid, restarted.pid);
      }),
    );

    it.effect("fails safely instead of unlinking a stale legacy lock", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const { home, daemonDir } = yield* tempHome;
        const lockPath = path.join(daemonDir, "daemon.lock");
        yield* fs.makeDirectory(daemonDir, { recursive: true });
        yield* fs.writeFileString(lockPath, String(2_147_483_647));

        const error = yield* Effect.flip(
          resolve({ home, daemonDir, port: 0, readyTimeoutMs: 15_000 }),
        );
        assert.match(error.message, /Refusing to automatically remove stale legacy daemon lock/);
        assert.equal(yield* fs.readFileString(lockPath), String(2_147_483_647));
      }),
    );

    it.effect("serializes concurrent launchers onto a single daemon", () =>
      Effect.gen(function* () {
        const { home, daemonDir } = yield* tempHome;
        const [a, b] = yield* Effect.all(
          [
            resolve({ home, daemonDir, port: 0, readyTimeoutMs: 15_000 }),
            resolve({ home, daemonDir, port: 0, readyTimeoutMs: 15_000 }),
          ],
          { concurrency: 2 },
        );
        assert.equal(a.pid, b.pid);
        assert.equal(a.address, b.address);
        assert.equal([a.reused, b.reused].filter((reused) => !reused).length, 1);
      }),
    );

    it.effect("does not attach while a different-key replacement holds the lock", () =>
      Effect.gen(function* () {
        const { home, daemonDir } = yield* tempHome;
        const old = yield* resolve({
          home,
          daemonDir,
          port: 0,
          readyTimeoutMs: 15_000,
          environment: { ...process.env, PIE_TEST_SHUTDOWN_DELAY_MS: "750" },
        });

        const replacementFiber = yield* Effect.forkChild(
          resolve({
            home,
            daemonDir,
            port: 0,
            readyTimeoutMs: 15_000,
            requiredCompatibilityKey: NEXT_KEY,
          }),
        );
        while (pidAlive(old.pid)) yield* Effect.sleep(10);

        const oldKeyDone = yield* Deferred.make<void>();
        const oldKeyFiber = yield* Effect.forkChild(
          resolve({ home, daemonDir, port: 0, readyTimeoutMs: 15_000 }).pipe(
            Effect.ensuring(Deferred.succeed(oldKeyDone, undefined)),
          ),
        );
        yield* Effect.sleep(100);
        assert.equal(yield* Deferred.isDone(oldKeyDone), false);

        const replacement = yield* Fiber.join(replacementFiber);
        const final = yield* Fiber.join(oldKeyFiber);
        assert.notEqual(replacement.pid, old.pid);
        assert.notEqual(final.pid, old.pid);
        assert.notEqual(final.pid, replacement.pid);
        assert.equal((yield* readRecord(daemonDir))?.compatibilityKey, TEST_KEY);
      }),
    );

    it.effect("serializes stop behind an in-flight replacement", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const { home, daemonDir } = yield* tempHome;
        const old = yield* resolve({
          home,
          daemonDir,
          port: 0,
          readyTimeoutMs: 15_000,
          environment: { ...process.env, PIE_TEST_SHUTDOWN_DELAY_MS: "750" },
        });

        const replacementFiber = yield* Effect.forkChild(
          resolve({
            home,
            daemonDir,
            port: 0,
            readyTimeoutMs: 15_000,
            requiredCompatibilityKey: NEXT_KEY,
          }),
        );
        while (pidAlive(old.pid)) yield* Effect.sleep(10);
        const stopFiber = yield* Effect.forkChild(stopDaemon(daemonDir));

        const replacement = yield* Fiber.join(replacementFiber);
        assert.equal(yield* Fiber.join(stopFiber), "stopped");
        assert.equal(pidAlive(replacement.pid), false);
        assert.equal(yield* readRecord(daemonDir), undefined);
        assert.equal(yield* fs.exists(path.join(daemonDir, "daemon.stopped")), true);
      }),
    );

    it.effect("serializes concurrent compatibility replacements onto one new daemon", () =>
      Effect.gen(function* () {
        const { home, daemonDir } = yield* tempHome;
        const old = yield* resolve({
          home,
          daemonDir,
          port: 0,
          readyTimeoutMs: 15_000,
          environment: { ...process.env, PIE_TEST_SHUTDOWN_DELAY_MS: "750" },
        });
        const next = {
          home,
          daemonDir,
          port: 0,
          readyTimeoutMs: 15_000,
          requiredCompatibilityKey: NEXT_KEY,
        };

        const [a, b] = yield* Effect.all([resolve(next), resolve(next)], { concurrency: 2 });
        assert.equal(pidAlive(old.pid), false);
        assert.equal(a.pid, b.pid);
        assert.notEqual(a.pid, old.pid);
        assert.equal([a.reused, b.reused].filter((reused) => !reused).length, 1);
        assert.equal((yield* readRecord(daemonDir))?.compatibilityKey, NEXT_KEY);
      }),
    );
  },
);
