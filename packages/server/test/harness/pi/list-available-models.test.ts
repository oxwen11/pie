import assert from "node:assert/strict";

import { describe, it } from "vitest";

import { listAvailablePiModels } from "../../../src/harness/pi/list-available-models";

describe("listAvailablePiModels", () => {
  it("returns AgentModel rows from Pi ModelRuntime without an RPC child", async () => {
    const models = await listAvailablePiModels(process.cwd());
    assert.ok(Array.isArray(models));
    for (const model of models) {
      assert.equal(typeof model.provider, "string");
      assert.equal(typeof model.modelId, "string");
      if (model.name !== undefined) assert.equal(typeof model.name, "string");
    }
  });
});
