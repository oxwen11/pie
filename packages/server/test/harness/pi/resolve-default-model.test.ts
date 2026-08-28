import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { SettingsManager } from "@earendil-works/pi-coding-agent";
import type { AgentModel } from "@getpie/contract";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resolveDefaultPiModel } from "../../../src/harness/pi/resolve-default-model";

const catalog: ReadonlyArray<AgentModel> = [
  { provider: "openai", modelId: "gpt-5.4" },
  { provider: "anthropic", modelId: "claude-sonnet-4-5", name: "Sonnet" },
];

describe("resolveDefaultPiModel", () => {
  it("returns the catalog row that matches Pi settings", () => {
    expect(
      resolveDefaultPiModel(catalog, {
        getDefaultProvider: () => "anthropic",
        getDefaultModel: () => "claude-sonnet-4-5",
      }),
    ).toEqual(catalog[1]);
  });

  it("falls through to the first catalog model when settings are empty", () => {
    expect(
      resolveDefaultPiModel(catalog, {
        getDefaultProvider: () => undefined,
        getDefaultModel: () => undefined,
      }),
    ).toEqual(catalog[0]);
  });

  it("falls through when the saved default is not in the catalog", () => {
    expect(
      resolveDefaultPiModel(catalog, {
        getDefaultProvider: () => "anthropic",
        getDefaultModel: () => "claude-opus-4-8",
      }),
    ).toEqual(catalog[0]);
  });

  it("returns undefined for an empty catalog", () => {
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
      expect(resolveDefaultPiModel(catalog, reread)).toEqual(catalog[1]);
    });
  });
});
