import assert from "node:assert/strict";

import { describe, it } from "vitest";

import { listAvailablePiModels } from "../../../src/harness/pi/list-available-models";

describe("listAvailablePiModels", () => {
  it("returns AgentModel rows and a default from Pi ModelRuntime without an RPC child", async () => {
    const catalog = await listAvailablePiModels(process.cwd());
    assert.ok(Array.isArray(catalog.models));
    for (const model of catalog.models) {
      assert.equal(typeof model.provider, "string");
      assert.equal(typeof model.modelId, "string");
      if (model.name !== undefined) assert.equal(typeof model.name, "string");
    }
    if (catalog.defaultModel) {
      assert.equal(typeof catalog.defaultModel.provider, "string");
      assert.equal(typeof catalog.defaultModel.modelId, "string");
    }
  });
});
