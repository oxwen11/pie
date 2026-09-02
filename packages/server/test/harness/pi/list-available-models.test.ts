import assert from "node:assert/strict";

import { Effect } from "effect";
import { describe, it } from "vitest";

import { listAvailablePiModels } from "../../../src/harness/pi/list-available-models";
import type { PiModelRef } from "../../../src/harness/pi/model-mapping";
import {
  resolveDefaultPiModel,
  type ResolveDefaultPiModelServices,
} from "../../../src/harness/pi/resolve-default-model";

const stubServices = (options: {
  readonly defaultProvider?: string;
  readonly defaultModel?: string;
  readonly configured?: PiModelRef;
  readonly authConfigured?: boolean;
}): ResolveDefaultPiModelServices => ({
  settingsManager: {
    getDefaultProvider: () => options.defaultProvider,
    getDefaultModel: () => options.defaultModel,
  },
  modelRuntime: {
    getModel: (provider, modelId) => {
      const configured = options.configured;
      if (!configured) return undefined;
      return configured.provider === provider && configured.id === modelId ? configured : undefined;
    },
    hasConfiguredAuth: () => options.authConfigured ?? true,
  },
});

describe("listAvailablePiModels", () => {
  it("returns AgentModel rows and a default from Pi ModelRuntime without an RPC child", async () => {
    const catalog = await Effect.runPromise(listAvailablePiModels(process.cwd()));
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

describe("resolveDefaultPiModel", () => {
  it("uses the settings default when that model is configured", () => {
    const configured = { provider: "anthropic", id: "claude-opus-4-8", name: "Opus" };
    const available = [{ provider: "openai", id: "gpt-5.5", name: "GPT" }];
    const selected = resolveDefaultPiModel(
      stubServices({
        defaultProvider: "anthropic",
        defaultModel: "claude-opus-4-8",
        configured,
      }),
      available,
    );
    assert.deepEqual(selected, { provider: "anthropic", modelId: "claude-opus-4-8", name: "Opus" });
  });

  it("falls back to the first table provider that has an available match", () => {
    const available = [
      { provider: "openai", id: "gpt-5.5", name: "GPT" },
      { provider: "anthropic", id: "claude-opus-4-8", name: "Opus" },
    ];
    const selected = resolveDefaultPiModel(stubServices({}), available);
    assert.deepEqual(selected, { provider: "anthropic", modelId: "claude-opus-4-8", name: "Opus" });
  });

  it("falls back to available[0] when nothing matches the table", () => {
    const available = [
      { provider: "custom", id: "my-model", name: "Custom" },
      { provider: "other", id: "other-model" },
    ];
    const selected = resolveDefaultPiModel(stubServices({}), available);
    assert.deepEqual(selected, { provider: "custom", modelId: "my-model", name: "Custom" });
  });

  it("returns undefined when available is empty", () => {
    const selected = resolveDefaultPiModel(stubServices({}), []);
    assert.equal(selected, undefined);
  });
});
