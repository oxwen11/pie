import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { SettingsManager } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { persistDefaultPiModel } from "../../../src/harness/pi/persist-default-model";

describe("persistDefaultPiModel", () => {
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

  it("writes defaultProvider/defaultModel into Pi global settings", async () => {
    await persistDefaultPiModel(agentDir, {
      provider: "anthropic",
      modelId: "claude-sonnet-4-5",
    });

    const settings = SettingsManager.create(agentDir);
    expect(settings.getDefaultProvider()).toBe("anthropic");
    expect(settings.getDefaultModel()).toBe("claude-sonnet-4-5");
  });
});
