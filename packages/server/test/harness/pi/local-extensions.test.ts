import assert from "node:assert/strict";
import path from "node:path";
import url from "node:url";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { layer } from "@effect/vitest";
import { Effect, FileSystem, Stream } from "effect";
import { afterEach, vi } from "vitest";

import { listAvailablePiCommands } from "../../../src/harness/pi/list-available-commands";
import { listAvailablePiModels } from "../../../src/harness/pi/list-available-models";
import { makePiProcess } from "../../../src/harness/pi/process";
import { resolvePiExecutable } from "../../../src/harness/pi/resolve-executable";
import { makePiTransport } from "../../../src/harness/pi/transport";

const provider = url.fileURLToPath(
  new URL("../../../../../tools/testing/fake-e2e-provider.ts", import.meta.url),
);

afterEach(() => vi.unstubAllEnvs());

const fixture = (source: "directory" | "package") =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const root = yield* fs.makeTempDirectoryScoped({ prefix: "pie-local-extensions-" });
    const agentDir = path.join(root, "agent");
    const cwd = path.join(root, "project");
    const extensions = path.join(agentDir, "extensions");
    const plugin = path.join(root, "plugin");
    yield* fs.makeDirectory(extensions, { recursive: true });
    yield* fs.makeDirectory(cwd);
    yield* fs.makeDirectory(plugin);
    vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
    vi.stubEnv("PI_OFFLINE", "1");
    yield* fs.copyFile(
      provider,
      path.join(source === "package" ? plugin : extensions, "provider.ts"),
    );
    yield* fs.writeFileString(
      path.join(plugin, "package.json"),
      JSON.stringify({ name: "test-local-plugin", pi: { extensions: ["provider.ts"] } }),
    );
    yield* fs.writeFileString(
      path.join(agentDir, "settings.json"),
      JSON.stringify({
        defaultProvider: "e2e",
        defaultModel: "fake",
        packages: source === "package" ? [plugin] : [],
        retry: { enabled: false },
      }),
    );
    yield* fs.writeFileString(
      path.join(extensions, "commands.ts"),
      `export default function (pi) {
        pi.registerCommand("local-ping", { description: "Local ping", handler: async () => {} });
        pi.on("input", (event) => event.text === "handled-input" ? { action: "handled" } : { action: "continue" });
      }`,
    );
    return { agentDir, cwd };
  });

layer(NodeServices.layer, { excludeTestServices: true })(
  "local Pi extensions in the real bundle",
  (it) => {
    for (const source of ["directory", "package"] as const) {
      it.effect(
        `discovers and runs a user ${source} plugin across create/resume and handled inputs`,
        () =>
          Effect.gen(function* () {
            const { agentDir, cwd } = yield* fixture(source);
            const listed = yield* listAvailablePiModels(cwd);
            assert.deepEqual(listed.defaultModel, {
              provider: "e2e",
              modelId: "fake",
              name: "E2E Fake",
            });
            const commands = yield* Effect.promise(() => listAvailablePiCommands(cwd, agentDir));
            assert.ok(
              commands.some(
                (command) => command.name === "local-ping" && command.source === "extension",
              ),
            );
            const process = yield* makePiProcess({ executable: resolvePiExecutable() });
            const created = yield* process.session.create({
              cwd,
              provider: "e2e",
              modelId: "fake",
            });
            for (const text of ["/local-ping", "handled-input"]) {
              const handled = yield* process.session.prompt({ sessionId: created.sessionId, text });
              assert.equal(handled.started, false);
              assert.deepEqual(Array.from(yield* Stream.runCollect(handled.output)), []);
            }
            const ordinary = yield* process.session.prompt({
              sessionId: created.sessionId,
              text: "hello",
            });
            assert.equal(ordinary.started, true);
            const chunks = Array.from(yield* Stream.runCollect(ordinary.output));
            assert.ok(
              chunks.some(
                (chunk) => chunk.type === "text-delta" && chunk.delta === "E2E fake Pi reply",
              ),
            );
            assert.equal(chunks.at(-1)?.type, "finish");
            yield* process.session.abort(created.sessionId);
            const resumed = yield* process.session.resume({ cwd, sessionId: created.sessionId });
            assert.equal(resumed.sessionId, created.sessionId);
            assert.equal((yield* process.session.getModelState(resumed.sessionId)).provider, "e2e");
            const handled = yield* process.session.prompt({
              sessionId: resumed.sessionId,
              text: "/local-ping",
            });
            assert.equal(handled.started, false);
            const followup = yield* process.session.prompt({
              sessionId: resumed.sessionId,
              text: "hello again",
            });
            assert.equal(followup.started, true);
            assert.equal(
              Array.from(yield* Stream.runCollect(followup.output)).at(-1)?.type,
              "finish",
            );
            yield* process.session.abort(resumed.sessionId);
          }),
        60000,
      );
    }

    it.effect(
      "honors explicit extension opt-out and Project trust in the bundled child",
      () =>
        Effect.gen(function* () {
          const { agentDir, cwd } = yield* fixture("directory");
          const fs = yield* FileSystem.FileSystem;
          const projectExtensions = path.join(cwd, ".pi", "extensions");
          const marker = path.join(cwd, "project-extension-loaded");
          yield* fs.makeDirectory(projectExtensions, { recursive: true });
          yield* fs.writeFileString(
            path.join(projectExtensions, "marker.ts"),
            `import fs from "node:fs"; fs.writeFileSync(${JSON.stringify(marker)}, "loaded"); export default function () {}`,
          );
          const transport = yield* makePiTransport({
            executable: resolvePiExecutable(),
            cwd,
            args: ["--no-approve"],
            env: { PI_CODING_AGENT_DIR: agentDir },
          });
          const untrusted = yield* transport.command<{ models: Array<{ provider: string }> }>({
            type: "get_available_models",
          });
          assert.ok(untrusted.models.some((model) => model.provider === "e2e"));
          assert.equal(yield* fs.exists(marker), false);
          const approved = yield* makePiTransport({
            executable: resolvePiExecutable(),
            cwd,
            args: ["--approve"],
            env: { PI_CODING_AGENT_DIR: agentDir },
          });
          yield* approved.command({ type: "get_state" });
          assert.equal(yield* fs.exists(marker), true);
          yield* fs.remove(marker);
          const disabled = yield* makePiTransport({
            executable: resolvePiExecutable(),
            cwd,
            args: ["--approve", "--no-extensions"],
            env: { PI_CODING_AGENT_DIR: agentDir },
          });
          const without = yield* disabled.command<{ models: Array<{ provider: string }> }>({
            type: "get_available_models",
          });
          assert.ok(!without.models.some((model) => model.provider === "e2e"));
          assert.equal(yield* fs.exists(marker), false);
          const explicit = yield* makePiTransport({
            executable: resolvePiExecutable(),
            cwd,
            args: [
              "--no-approve",
              "--no-extensions",
              "--extension",
              path.join(agentDir, "extensions/provider.ts"),
            ],
            env: { PI_CODING_AGENT_DIR: agentDir },
          });
          const selected = yield* explicit.command<{ models: Array<{ provider: string }> }>({
            type: "get_available_models",
          });
          assert.ok(selected.models.some((model) => model.provider === "e2e"));
          assert.equal(yield* fs.exists(marker), false);
        }),
      60000,
    );
  },
);
