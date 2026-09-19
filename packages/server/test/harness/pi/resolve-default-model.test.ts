import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { SettingsManager } from "@earendil-works/pi-coding-agent";
import type { AgentModel } from "@getpie/contract";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resolveDefaultPiModel } from "../../../src/harness/pi/resolve-default-model";

const models: ReadonlyArray<AgentModel> = [
  { provider: "openai", modelId: "gpt-5.4" },
  { provider: "anthropic", modelId: "claude-sonnet-4-5", name: "Sonnet" },
];

describe("resolveDefaultPiModel", () => {
  it("returns the available model that matches Pi settings", () => {
    expect(
      resolveDefaultPiModel(models, {
        getDefaultProvider: () => "anthropic",
        getDefaultModel: () => "claude-sonnet-4-5",
      }),
    ).toEqual(models[1]);
  });

  it("falls through to the first available model when settings are empty", () => {
    expect(
      resolveDefaultPiModel(models, {
        getDefaultProvider: () => undefined,
        getDefaultModel: () => undefined,
      }),
    ).toEqual(models[0]);
  });

  it("falls through when the saved default is not among available models", () => {
    expect(
      resolveDefaultPiModel(models, {
        getDefaultProvider: () => "anthropic",
        getDefaultModel: () => "claude-opus-4-8",
      }),
    ).toEqual(models[0]);
  });

  it("returns undefined when no models are available", () => {
    expect(
      resolveDefaultPiModel([], {
        getDefaultProvider: () => "anthropic",
        getDefaultModel: () => "claude-sonnet-4-5",
      }),
    ).toBeUndefined();
  });

  describe("SettingsManager", () => {
    let agentDir: string;
    let previous: string | undefined;

    beforeEach(async () => {
      agentDir = await fs.mkdtemp(path.join(os.tmpdir(), "pie-pi-agent-"));
      previous = process.env.PI_CODING_AGENT_DIR;
      process.env.PI_CODING_AGENT_DIR = agentDir;
    });

    afterEach(async () => {
      if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
      else process.env.PI_CODING_AGENT_DIR = previous;
      await fs.rm(agentDir, { recursive: true, force: true });
    });

    it("reads the default Pi writes into SettingsManager", async () => {
      const settings = SettingsManager.create(agentDir);
      settings.setDefaultModelAndProvider("anthropic", "claude-sonnet-4-5");
      await settings.flush();

      const reread = SettingsManager.create(agentDir);
      expect(resolveDefaultPiModel(models, reread)).toEqual(models[1]);
    });
  });
});
