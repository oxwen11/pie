import assert from "node:assert/strict";
import childProcess from "node:child_process";
import events from "node:events";
import path from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { layer } from "@effect/vitest";
import { Effect, FileSystem } from "effect";

import { acquireLock } from "../../src/daemon/lock";

layer(NodeServices.layer)("daemon lock", (it) => {
  const tempDaemonDir = FileSystem.FileSystem.pipe(
    Effect.flatMap((fileSystem) =>
      fileSystem.makeTempDirectoryScoped({ prefix: "pie-daemon-lock-" }),
    ),
  );

  it.effect("serializes launchers through daemon.lock", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const daemonDir = yield* tempDaemonDir;
      const lockDatabase = path.join(daemonDir, "daemon.lock");

      const first = yield* acquireLock(daemonDir, 100);
      assert.equal(yield* fileSystem.exists(lockDatabase), true);
      assert.equal((yield* Effect.exit(acquireLock(daemonDir, 100)))._tag, "Failure");

      yield* first.release;
      const successor = yield* acquireLock(daemonDir, 100);
      yield* successor.release;
      assert.equal(yield* fileSystem.exists(lockDatabase), true);
    }),
  );

  it.effect("releases daemon.lock when its owner process crashes", () =>
    Effect.gen(function* () {
      const daemonDir = yield* tempDaemonDir;
      const lockDatabase = path.join(daemonDir, "daemon.lock");
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
