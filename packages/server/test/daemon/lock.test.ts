import assert from "node:assert/strict";
import childProcess from "node:child_process";
import events from "node:events";
import fs from "node:fs";
import path from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { layer } from "@effect/vitest";
import { Effect, FileSystem } from "effect";

import { acquireLock, migrateLegacyLock } from "../../src/daemon/lock";

layer(NodeServices.layer)("daemon lock", (it) => {
  const tempDaemonDir = FileSystem.FileSystem.pipe(
    Effect.flatMap((fileSystem) =>
      fileSystem.makeTempDirectoryScoped({ prefix: "pie-daemon-lock-" }),
    ),
  );

  it.effect("serializes launchers through an OS-backed SQLite transaction", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const daemonDir = yield* tempDaemonDir;
      const lockDatabase = path.join(daemonDir, "daemon.lock.v2");

      const first = yield* acquireLock(daemonDir, 100);
      assert.equal(yield* fileSystem.exists(lockDatabase), true);
      assert.equal((yield* Effect.exit(acquireLock(daemonDir, 100)))._tag, "Failure");

      yield* first.release;
      const successor = yield* acquireLock(daemonDir, 100);
      yield* successor.release;
      assert.equal(yield* fileSystem.exists(lockDatabase), true);
    }),
  );

  it.effect("releases the v2 SQLite transaction when its owner process crashes", () =>
    Effect.gen(function* () {
      const daemonDir = yield* tempDaemonDir;
      const lockDatabase = path.join(daemonDir, "daemon.lock.v2");
      const child = childProcess.spawn(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          `import { DatabaseSync } from "node:sqlite";
           const database = new DatabaseSync(process.env.LOCK_DATABASE);
           database.exec("BEGIN IMMEDIATE");
           console.log("ready");
           setInterval(() => {}, 1000);`,
        ],
        { env: { ...process.env, LOCK_DATABASE: lockDatabase }, stdio: ["ignore", "pipe", "pipe"] },
      );
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          if (child.exitCode === null) child.kill("SIGKILL");
        }),
      );
      yield* Effect.promise(
        () =>
          new Promise<void>((resolve, reject) => {
            child.stdout.once("data", () => resolve());
            child.once("error", reject);
          }),
      );

      assert.equal((yield* Effect.exit(acquireLock(daemonDir, 100)))._tag, "Failure");
      const childExited = events.once(child, "exit");
      child.kill("SIGKILL");
      yield* Effect.promise(() => childExited.then(() => undefined));

      const recovered = yield* acquireLock(daemonDir, 500);
      yield* recovered.release;
    }),
  );

  it.effect("holds the legacy exclusion domain for old launchers", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const daemonDir = yield* tempDaemonDir;
      const legacyLock = path.join(daemonDir, "daemon.lock");

      const current = yield* acquireLock(daemonDir, 500);
      const legacyAttempt = yield* Effect.exit(
        Effect.tryPromise(() =>
          fs.promises.writeFile(legacyLock, "old", { flag: "wx", mode: 0o600 }),
        ),
      );
      assert.equal(legacyAttempt._tag, "Failure");
      yield* current.release;
      assert.equal(yield* fileSystem.exists(legacyLock), false);

      const old = childProcess.spawn(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          `import fs from "node:fs";
           const lock = process.env.LEGACY_LOCK;
           fs.writeFileSync(lock, String(process.pid), { flag: "wx" });
           process.on("SIGTERM", () => {
             fs.rmSync(lock, { force: true });
             process.exit(0);
           });
           console.log("ready");
           setInterval(() => {}, 1000);`,
        ],
        { env: { ...process.env, LEGACY_LOCK: legacyLock }, stdio: ["ignore", "pipe", "pipe"] },
      );
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          if (old.exitCode === null) old.kill("SIGKILL");
        }),
      );
      yield* Effect.promise(
        () =>
          new Promise<void>((resolve, reject) => {
            old.stdout.once("data", () => resolve());
            old.once("error", reject);
            old.once("exit", (code) => reject(new Error(`legacy child exited ${code}`)));
          }),
      );

      let acquired = false;
      const newOwner = Effect.runPromise(acquireLock(daemonDir, 1_000)).then((lock) => {
        acquired = true;
        return lock;
      });
      yield* Effect.promise(
        () =>
          new Promise<void>((resolve) => {
            setTimeout(resolve, 100);
          }),
      );
      assert.equal(acquired, false);

      const oldExited = events.once(old, "exit");
      old.kill("SIGTERM");
      yield* Effect.promise(() => oldExited.then(() => undefined));
      const recovered = yield* Effect.promise(() => newOwner);
      yield* recovered.release;
    }),
  );

  it.effect("retries when a live legacy owner releases between lstat and read", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const daemonDir = yield* tempDaemonDir;
      const legacyLock = path.join(daemonDir, "daemon.lock");
      yield* fileSystem.writeFileString(legacyLock, String(process.pid));

      let released = false;
      yield* Effect.promise(() =>
        migrateLegacyLock(legacyLock, 100, async () => {
          if (released) return;
          released = true;
          await fs.promises.unlink(legacyLock);
        }),
      );
      assert.equal(yield* fileSystem.exists(legacyLock), false);
    }),
  );

  it.effect("fails safely on a stale legacy pid-only lock", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const daemonDir = yield* tempDaemonDir;
      const legacyLock = path.join(daemonDir, "daemon.lock");
      yield* fileSystem.writeFileString(legacyLock, String(2_147_483_647));

      const result = yield* Effect.exit(acquireLock(daemonDir, 100));
      assert.equal(result._tag, "Failure");
      assert.equal(yield* fileSystem.readFileString(legacyLock), String(2_147_483_647));
    }),
  );

  it.effect("fails safely on a malformed legacy lock", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const daemonDir = yield* tempDaemonDir;
      const legacyLock = path.join(daemonDir, "daemon.lock");
      yield* fileSystem.writeFileString(legacyLock, "not-a-lock");

      const result = yield* Effect.exit(acquireLock(daemonDir, 100));
      assert.equal(result._tag, "Failure");
      assert.equal(yield* fileSystem.readFileString(legacyLock), "not-a-lock");
    }),
  );

  it.effect("locks in two daemon directories do not exclude each other", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const root = yield* tempDaemonDir;
      const [firstDir, secondDir] = [path.join(root, "a"), path.join(root, "b")];
      yield* Effect.forEach([firstDir, secondDir], (dir) =>
        fileSystem.makeDirectory(dir, { recursive: true }),
      );

      const [first, second] = yield* Effect.all([
        acquireLock(firstDir, 100),
        acquireLock(secondDir, 100),
      ]);
      yield* Effect.all([first.release, second.release]);
    }),
  );
});
