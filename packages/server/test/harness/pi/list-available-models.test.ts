import assert from "node:assert/strict";
import path from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { layer } from "@effect/vitest";
import { Effect, FileSystem } from "effect";

import { listAvailablePiModels } from "../../../src/pi/list-available-models";

layer(NodeServices.layer)("listAvailablePiModels", (it) => {
  it.effect("includes models registered by Project extensions", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const agentDir = yield* fs.makeTempDirectoryScoped({ prefix: "pie-agent-models-" });
      const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "pie-models-extension-" });
      const extensionDirectory = path.join(cwd, ".pi", "extensions");
      yield* fs.makeDirectory(extensionDirectory, { recursive: true });
      yield* fs.writeFileString(
        path.join(extensionDirectory, "provider.ts"),
        `export default function providerExtension(pi) {
  pi.registerProvider("pie-test-provider", {
    baseUrl: "http://127.0.0.1:9/v1",
    apiKey: "test-key",
    api: "openai-completions",
    models: [
      {
        id: "pie-test-model",
        name: "Pie Test Model",
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 8000,
        maxTokens: 1000,
      },
    ],
  });
}
`,
      );

      const listed = yield* listAvailablePiModels(cwd, agentDir);
      assert.deepEqual(
        listed.models.find((model) => model.provider === "pie-test-provider"),
        { provider: "pie-test-provider", modelId: "pie-test-model", name: "Pie Test Model" },
      );
      assert.ok(listed.defaultModel !== undefined);
    }),
  );
});
