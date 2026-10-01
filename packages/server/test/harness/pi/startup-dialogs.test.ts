import assert from "node:assert/strict";
import path from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { layer } from "@effect/vitest";
import { Effect, Fiber, FileSystem, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import { afterEach, vi } from "vitest";

import { listAvailablePiCommands } from "../../../src/harness/pi/list-available-commands";
import { makePiProcess } from "../../../src/harness/pi/process";
import { mapUiResponse } from "../../../src/harness/pi/request";
import { resolvePiExecutable } from "../../../src/harness/pi/resolve-executable";
import { makePiTransport } from "../../../src/harness/pi/transport";

const fixture = () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const root = yield* fs.makeTempDirectoryScoped({ prefix: "pie-startup-dialogs-" });
    const agentDir = path.join(root, "agent");
    const cwd = path.join(root, "project");
    const marker = path.join(root, "answers.json");
    yield* fs.makeDirectory(path.join(agentDir, "extensions"), { recursive: true });
    yield* fs.makeDirectory(cwd);
    vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
    vi.stubEnv("PI_OFFLINE", "1");
    yield* fs.writeFileString(
      path.join(agentDir, "extensions", "startup.ts"),
      `import fs from "node:fs";
      export default function (pi) {
        pi.registerCommand("startup-done", { handler: async () => {} });
        pi.on("session_start", async (_event, ctx) => {
          if (!ctx.hasUI) throw new Error("RPC UI is unavailable");
          // Bound regressions without relying on a test timeout to reap the child.
          const deadline = setTimeout(() => process.exit(7), 5000);
          try {
            const confirmed = await ctx.ui.confirm("Startup confirmation", "Continue?");
            const selected = await ctx.ui.select("Startup selection", ["Continue"]);
            const input = await ctx.ui.input("Startup input");
            const editor = await ctx.ui.editor("Startup editor");
            fs.writeFileSync(${JSON.stringify(marker)}, JSON.stringify({
              confirmed, selected: selected ?? null, input: input ?? null, editor: editor ?? null,
            }));
          } finally { clearTimeout(deadline); }
        });
      }`,
    );
    return { agentDir, cwd, marker, fs };
  });

const declined = { confirmed: false, selected: null, input: null, editor: null };

afterEach(() => vi.unstubAllEnvs());

layer(NodeServices.layer, { excludeTestServices: true })("Pi startup dialogs", (it) => {
  it.effect("reads startup UI replies before the initial get_state completes", () =>
    Effect.gen(function* () {
      const { agentDir, cwd, marker, fs } = yield* fixture();
      const transport = yield* makePiTransport({
        executable: resolvePiExecutable(),
        cwd,
        env: { PI_CODING_AGENT_DIR: agentDir },
      });
      yield* Stream.runForEach(transport.uiRequests, (request) =>
        transport.respondUi(
          mapUiResponse(request, {
            type: "question",
            answers: [
              {
                questionId: request.id,
                values: [request.method === "confirm" ? "Yes" : "Continue"],
              },
            ],
          }),
        ),
      ).pipe(Effect.forkScoped);
      yield* transport.command({ type: "get_state" });
      assert.deepEqual(JSON.parse(yield* fs.readFileString(marker)), {
        confirmed: true,
        selected: "Continue",
        input: "Continue",
        editor: "Continue",
      });
    }),
  );

  it.effect(
    "declines startup dialogs before the parent readiness handshake on create and resume",
    () =>
      Effect.gen(function* () {
        const { cwd, marker, fs } = yield* fixture();
        const process = yield* makePiProcess({ executable: resolvePiExecutable() });
        const created = yield* process.session.create({ cwd });
        assert.deepEqual(JSON.parse(yield* fs.readFileString(marker)), declined);
        yield* process.session.abort(created.sessionId);
        yield* fs.remove(marker);
        const resumed = yield* process.session.resume({ cwd, sessionId: created.sessionId });
        assert.deepEqual(JSON.parse(yield* fs.readFileString(marker)), declined);
        yield* process.session.abort(resumed.sessionId);
      }),
  );

  it.effect(
    "cancels unanswered startup dialogs on EOF and drains admitted commands before exit",
    () =>
      Effect.gen(function* () {
        const { agentDir, cwd, marker, fs } = yield* fixture();
        const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
        const executable = resolvePiExecutable();
        const child = yield* spawner.spawn(
          ChildProcess.make(executable.command, [...executable.prefixArgs, "--mode", "rpc"], {
            cwd,
            env: {
              PATH: process.env.PATH,
              HOME: agentDir,
              PI_CODING_AGENT_DIR: agentDir,
              PI_OFFLINE: "1",
            },
            stdin: Stream.make('{"id":"state","type":"get_state"}\n').pipe(Stream.encodeText),
          }),
        );
        const stderr = yield* Stream.runCollect(child.stderr.pipe(Stream.decodeText())).pipe(
          Effect.forkScoped,
        );
        const output = (yield* Stream.runCollect(child.stdout.pipe(Stream.decodeText()))).join("");
        assert.equal(yield* child.exitCode, 0, (yield* Fiber.join(stderr)).join(""));
        assert.match(output, /"id":"state","type":"response","command":"get_state","success":true/);
        assert.deepEqual(JSON.parse(yield* fs.readFileString(marker)), declined);
      }),
  );

  it.effect("does not approve incidental Project extensions during global command discovery", () =>
    Effect.gen(function* () {
      const { agentDir, fs } = yield* fixture();
      const projectExtensions = path.join(agentDir, ".pi", "extensions");
      const marker = path.join(agentDir, "incidental-project-loaded");
      yield* fs.makeDirectory(projectExtensions, { recursive: true });
      yield* fs.writeFileString(
        path.join(agentDir, "settings.json"),
        JSON.stringify({ defaultProjectTrust: "always" }),
      );
      yield* fs.writeFileString(
        path.join(projectExtensions, "incidental.ts"),
        `import fs from "node:fs";
        fs.writeFileSync(${JSON.stringify(marker)}, "loaded");
        export default function (pi) {
          pi.registerCommand("incidental", { handler: async () => {} });
        }`,
      );
      const commands = yield* Effect.promise(() => listAvailablePiCommands(undefined, agentDir));
      assert.ok(commands.some((command) => command.name === "startup-done"));
      assert.ok(!commands.some((command) => command.name === "incidental"));
      assert.equal(yield* fs.exists(marker), false);
    }),
  );

  it.effect("declines startup dialogs during noninteractive command discovery", () =>
    Effect.gen(function* () {
      const { agentDir, cwd, marker, fs } = yield* fixture();
      const commands = yield* Effect.promise(() => listAvailablePiCommands(cwd, agentDir));
      assert.ok(commands.some((command) => command.name === "startup-done"));
      assert.deepEqual(JSON.parse(yield* fs.readFileString(marker)), declined);
    }),
  );
});
