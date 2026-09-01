import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, it } from "vitest";

import { listAvailablePiModels } from "../../../src/harness/pi/list-available-models";

describe("listAvailablePiModels", () => {
  it("returns AgentModel rows and a default from Pi ModelRuntime without an RPC child", async () => {
    const result = await listAvailablePiModels(process.cwd());
    assert.ok(Array.isArray(result.models));
    for (const model of result.models) {
      assert.equal(typeof model.provider, "string");
      assert.equal(typeof model.modelId, "string");
      if (model.name !== undefined) assert.equal(typeof model.name, "string");
    }
    if (result.defaultModel) {
      assert.equal(typeof result.defaultModel.provider, "string");
      assert.equal(typeof result.defaultModel.modelId, "string");
    }
  });

  it("does not execute Project extensions while reading the model list", async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pie-model-policy-"));
    const extensionDirectory = path.join(cwd, ".pi", "extensions");
    const marker = path.join(cwd, "extension-loaded");
    fs.mkdirSync(extensionDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(extensionDirectory, "marker.ts"),
      `import fs from "node:fs";\nfs.writeFileSync(${JSON.stringify(marker)}, "loaded");\nexport default function markerExtension() {}\n`,
    );

    try {
      await listAvailablePiModels(cwd);
      assert.equal(fs.existsSync(marker), false);
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });
});
