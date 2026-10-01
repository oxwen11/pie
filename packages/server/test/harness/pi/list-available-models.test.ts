import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { Effect } from "effect";
import { afterEach, describe, it, vi } from "vitest";

afterEach(() => vi.unstubAllEnvs());

import { listAvailablePiModels } from "../../../src/harness/pi/list-available-models";

describe("listAvailablePiModels", () => {
  it("returns AgentModel rows and a default from Pi ModelRuntime without pie-pi-process", async () => {
    const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "pie-model-rows-"));
    vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
    vi.stubEnv("PI_OFFLINE", "1");
    fs.writeFileSync(
      path.join(agentDir, "models.json"),
      JSON.stringify({
        providers: {
          "rows-test": {
            api: "openai-responses",
            baseUrl: "http://127.0.0.1:1/v1",
            apiKey: "synthetic-key",
            models: [{ id: "model" }],
          },
        },
      }),
    );
    try {
      const listed = await Effect.runPromise(listAvailablePiModels());
      assert.ok(listed.models.some((model) => model.provider === "rows-test"));
      for (const model of listed.models) {
        assert.equal(typeof model.provider, "string");
        assert.equal(typeof model.modelId, "string");
        if (model.name !== undefined) assert.equal(typeof model.name, "string");
      }
      if (listed.defaultModel) {
        assert.equal(typeof listed.defaultModel.provider, "string");
        assert.equal(typeof listed.defaultModel.modelId, "string");
      }
    } finally {
      fs.rmSync(agentDir, { recursive: true, force: true });
    }
  });

  it.each(["directory", "package"])(
    "discovers a provider from a user %s extension without static models",
    async (source) => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "pie-user-models-"));
      const agentDir = path.join(root, "agent");
      const cwd = path.join(root, "project");
      const extensionDirectory = path.join(agentDir, "extensions");
      const packageDirectory = path.join(root, "plugin");
      fs.mkdirSync(extensionDirectory, { recursive: true });
      fs.mkdirSync(packageDirectory);
      fs.mkdirSync(cwd);
      vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
      vi.stubEnv("PI_OFFLINE", "1");
      fs.writeFileSync(
        path.join(agentDir, "models.json"),
        JSON.stringify({
          providers: {
            "user-proxy": {
              baseUrl: "http://127.0.0.1:1/v1",
              api: "openai-responses",
              apiKey: "synthetic-test-key",
            },
          },
        }),
      );
      fs.writeFileSync(
        path.join(agentDir, "settings.json"),
        JSON.stringify({
          defaultProvider: "user-proxy",
          defaultModel: "discovered",
          packages: source === "package" ? [packageDirectory] : [],
        }),
      );
      const extension = `export default async function (pi) {
        pi.registerProvider("user-proxy", {
          baseUrl: "http://127.0.0.1:1/v1", api: "openai-responses",
          models: [{ id: "discovered", name: "Discovered Model", reasoning: false,
            input: ["text"], contextWindow: 128000, maxTokens: 4096,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
        });
      }`;
      if (source === "package") {
        fs.writeFileSync(
          path.join(packageDirectory, "package.json"),
          JSON.stringify({ name: "test-user-plugin", pi: { extensions: ["provider.mjs"] } }),
        );
        fs.writeFileSync(path.join(packageDirectory, "provider.mjs"), extension);
      } else {
        fs.writeFileSync(path.join(extensionDirectory, "provider.ts"), extension);
      }

      try {
        const listed = await Effect.runPromise(listAvailablePiModels(cwd));
        const model = { provider: "user-proxy", modelId: "discovered", name: "Discovered Model" };
        assert.deepEqual(
          listed.models.filter((row) => row.provider === "user-proxy"),
          [model],
        );
        assert.deepEqual(listed.defaultModel, model);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  );

  it("loads Project extensions only for an explicitly supplied Project", async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pie-model-policy-"));
    vi.stubEnv("PI_CODING_AGENT_DIR", cwd);
    vi.stubEnv("PI_OFFLINE", "1");
    const extensionDirectory = path.join(cwd, ".pi", "extensions");
    const marker = path.join(cwd, "extension-loaded");
    fs.mkdirSync(extensionDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(cwd, "settings.json"),
      JSON.stringify({ defaultProjectTrust: "always" }),
    );
    fs.writeFileSync(
      path.join(extensionDirectory, "marker.ts"),
      `import fs from "node:fs";\nfs.writeFileSync(${JSON.stringify(marker)}, "loaded");\nexport default function markerExtension() {}\n`,
    );

    try {
      await Effect.runPromise(listAvailablePiModels());
      assert.equal(fs.existsSync(marker), false);
      await Effect.runPromise(listAvailablePiModels(cwd));
      assert.equal(fs.existsSync(marker), true);
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });
});
