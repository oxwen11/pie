import assert from "node:assert/strict";
import crypto from "node:crypto";
import path from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { layer } from "@effect/vitest";
import { Effect, Fiber, FileSystem, Schedule, Stream } from "effect";

import { listAvailablePiModels } from "../../../src/harness/pi/list-available-models";
import { PI_PROJECT_PROCESS_ARGS } from "../../../src/harness/pi/project-resource-policy";
import { resolvePiExecutable } from "../../../src/harness/pi/resolve-executable";
import { makePiTransport } from "../../../src/harness/pi/transport";

// Opens dialogs at startup and from a command; records each answer.
const writeDialogExtension = (cwd: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const extensionDirectory = path.join(cwd, ".pi", "extensions");
    yield* fs.makeDirectory(extensionDirectory, { recursive: true });
    yield* fs.writeFileString(
      path.join(extensionDirectory, "dialogs.ts"),
      `import { appendFileSync } from "node:fs";
const record = (line) => appendFileSync(${JSON.stringify(path.join(cwd, "answers.log"))}, line + "\\n");
export default function dialogs(pi) {
  pi.registerProvider("dialog-provider", {
    baseUrl: "http://127.0.0.1:9/v1",
    apiKey: "test-key",
    api: "openai-completions",
    models: [{
      id: "dialog-model", name: "Dialog Model", reasoning: false, input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 8000, maxTokens: 1000,
    }],
  });
  pi.on("session_start", async (_event, ctx) => {
    record("startup=" + (await ctx.ui.confirm("Startup", "allow?")) + " editor=" + (await ctx.ui.editor("Startup", "draft")));
  });
  pi.registerCommand("ask", {
    description: "Ask",
    handler: async (_args, ctx) => {
      record("command=" + (await ctx.ui.confirm("Command", "allow?")));
    },
  });
}
`,
    );
  });

const awaitAnswers = (cwd: string, count: number) =>
  FileSystem.FileSystem.pipe(
    Effect.flatMap((fs) => fs.readFileString(path.join(cwd, "answers.log"))),
    Effect.map((text) => text.trim().split("\n")),
    Effect.filterOrFail((lines) => lines.length >= count),
    Effect.retry({ schedule: Schedule.spaced("100 millis"), times: 100 }),
  );

const makeProject = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const agentDir = yield* fs.makeTempDirectoryScoped({ prefix: "pie-agent-dialogs-" });
  const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "pie-startup-dialogs-" });
  yield* writeDialogExtension(cwd);
  return { agentDir, cwd };
});

layer(NodeServices.layer, { excludeTestServices: true })("Pi startup dialogs", (it) => {
  it.effect("discovery declines a startup dialog and still lists extension models", () =>
    Effect.gen(function* () {
      const { agentDir, cwd } = yield* makeProject;

      const listed = yield* listAvailablePiModels(cwd, agentDir, "20 seconds");

      assert.ok(listed.models.some((model) => model.modelId === "dialog-model"));
      assert.deepEqual(yield* awaitAnswers(cwd, 1), ["startup=false editor=undefined"]);
    }),
  );

  it.effect("a session starts past a startup dialog and later dialogs reach the host", () =>
    Effect.gen(function* () {
      const { agentDir, cwd } = yield* makeProject;
      const transport = yield* makePiTransport({
        executable: resolvePiExecutable(),
        cwd,
        sessionId: crypto.randomUUID(),
        args: PI_PROJECT_PROCESS_ARGS,
        env: { PI_CODING_AGENT_DIR: agentDir },
      });

      yield* transport.command({ type: "get_state" }).pipe(Effect.timeout("20 seconds"));
      assert.deepEqual(yield* awaitAnswers(cwd, 1), ["startup=false editor=undefined"]);

      // The command's prompt response waits for its handler, which waits for the dialog.
      const prompt = yield* Effect.forkChild(
        transport.command({ type: "prompt", message: "/ask" }),
      );
      const [request] = yield* Stream.runCollect(Stream.take(transport.uiRequests, 1));
      assert.equal(request?.method, "confirm");
      yield* transport.respondUi({
        type: "extension_ui_response",
        id: request.id,
        confirmed: true,
      });

      yield* Fiber.join(prompt);
      assert.deepEqual(yield* awaitAnswers(cwd, 2), [
        "startup=false editor=undefined",
        "command=true",
      ]);
    }),
  );
});
