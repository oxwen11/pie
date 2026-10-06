import assert from "node:assert/strict";
import path from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { layer } from "@effect/vitest";
import { Effect, Fiber, FileSystem, Schedule } from "effect";

import { PiTransportError } from "../../../src/harness/errors";
import { listAvailablePiCommands } from "../../../src/pi/list-available-commands";
import { listAvailablePiModels } from "../../../src/pi/list-available-models";

// Publishes the child pid atomically, then never finishes loading.
const writeStalledExtension = (cwd: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const extensionDirectory = path.join(cwd, ".pi", "extensions");
    yield* fs.makeDirectory(extensionDirectory, { recursive: true });
    yield* fs.writeFileString(
      path.join(extensionDirectory, "stall.ts"),
      `import { renameSync, writeFileSync } from "node:fs";
export default async function stall() {
  const pidFile = ${JSON.stringify(path.join(cwd, "child.pid"))};
  writeFileSync(pidFile + ".tmp", String(process.pid));
  renameSync(pidFile + ".tmp", pidFile);
  // A live handle, like a hung network request, keeps the child running.
  await new Promise(() => setInterval(() => {}, 1000));
}
`,
    );
  });

const readChildPid = (cwd: string) =>
  FileSystem.FileSystem.pipe(
    Effect.flatMap((fs) => fs.readFileString(path.join(cwd, "child.pid"))),
    Effect.map(Number),
    Effect.retry({ schedule: Schedule.spaced("100 millis"), times: 200 }),
  );

const isAlive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const awaitExited = (pid: number) =>
  Effect.suspend(() => (isAlive(pid) ? Effect.fail("alive") : Effect.void)).pipe(
    Effect.retry({ schedule: Schedule.spaced("100 millis"), times: 50 }),
  );

const makeProject = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const agentDir = yield* fs.makeTempDirectoryScoped({ prefix: "pie-agent-discovery-" });
  const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "pie-discovery-stall-" });
  yield* writeStalledExtension(cwd);
  return { agentDir, cwd };
});

layer(NodeServices.layer, { excludeTestServices: true })("Pi discovery children", (it) => {
  it.effect("model discovery times out and terminates a stalled child", () =>
    Effect.gen(function* () {
      const { agentDir, cwd } = yield* makeProject;

      const error = yield* Effect.flip(listAvailablePiModels(cwd, agentDir, "3 seconds"));

      assert.equal(error.operation, "list-models");
      assert.ok(error.cause instanceof PiTransportError);
      assert.equal(error.cause.operation, "get_available_models-timeout");
      yield* awaitExited(yield* readChildPid(cwd));
    }),
  );

  it.effect("command discovery times out and terminates a stalled child", () =>
    Effect.gen(function* () {
      const { agentDir, cwd } = yield* makeProject;

      const error = yield* Effect.flip(listAvailablePiCommands(cwd, agentDir, "3 seconds"));

      assert.equal(error.operation, "list-commands");
      assert.ok(error.cause instanceof PiTransportError);
      assert.equal(error.cause.operation, "get_commands-timeout");
      yield* awaitExited(yield* readChildPid(cwd));
    }),
  );

  it.effect("interrupting command discovery terminates its child", () =>
    Effect.gen(function* () {
      const { agentDir, cwd } = yield* makeProject;

      const fiber = yield* Effect.forkChild(listAvailablePiCommands(cwd, agentDir));
      const pid = yield* readChildPid(cwd);
      assert.ok(isAlive(pid));
      yield* Fiber.interrupt(fiber);

      yield* awaitExited(pid);
    }),
  );
});
