import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { makeSkillService } from "../src/skills";

describe("skills service", () => {
  it("lists user skills discovered under the agent dir", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "pie-home-"));
    const agentDir = path.join(home, "pi-agent");
    const skillDir = path.join(agentDir, "skills", "demo-skill");
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, "SKILL.md"),
      [
        "---",
        "name: demo-skill",
        "description: Demo skill for tests",
        "---",
        "",
        "# Demo",
        "",
      ].join("\n"),
    );
    const svc = makeSkillService(() => agentDir);
    await expect(Effect.runPromise(svc.list())).resolves.toEqual([
      expect.objectContaining({
        name: "demo-skill",
        description: "Demo skill for tests",
        source: expect.any(String),
        scope: "user",
        path: expect.stringContaining("SKILL.md"),
      }),
    ]);
  });
});
