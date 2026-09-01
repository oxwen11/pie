import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { makeRpcTestHarness } from "./rpc-harness";

describe("agent router", () => {
  it("lists prompt commands and skills from the requested Project", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "pie-home-agent-"));
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "pie-agent-project-"));
    fs.mkdirSync(path.join(workspace, ".pi", "prompts"), { recursive: true });
    fs.mkdirSync(path.join(workspace, ".agents", "skills", "review"), { recursive: true });
    fs.writeFileSync(
      path.join(workspace, ".pi", "prompts", "explain.md"),
      "---\ndescription: Explain this project\n---\nExplain $@",
    );
    fs.writeFileSync(
      path.join(workspace, ".agents", "skills", "review", "SKILL.md"),
      "---\nname: review\ndescription: Review this project\n---\nReview it.",
    );

    const { client, dispose } = await makeRpcTestHarness(home);
    try {
      const project = await client.project.create({ path: workspace });
      const commands = await client.agent.commands({ projectId: project.id });

      expect(commands).toContainEqual({
        name: "explain",
        description: "Explain this project",
        source: "prompt",
      });
      expect(commands).toContainEqual({
        name: "skill:review",
        description: "Review this project",
        source: "skill",
      });
    } finally {
      await dispose();
      fs.rmSync(home, { recursive: true, force: true });
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });

  it("lists global commands when no Project is selected", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "pie-home-agent-"));
    const { client, dispose } = await makeRpcTestHarness(home);
    try {
      const commands = await client.agent.commands({});
      expect(Array.isArray(commands)).toBe(true);
    } finally {
      await dispose();
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it("returns NOT_FOUND for an unknown Project", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "pie-home-agent-"));
    const { client, dispose } = await makeRpcTestHarness(home);
    try {
      await expect(
        client.agent.commands({ projectId: "0195b4b3-6dc4-7d41-a9ce-3ab5dcb6cc61" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    } finally {
      await dispose();
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});
