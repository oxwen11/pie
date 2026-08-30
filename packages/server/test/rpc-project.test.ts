import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { makeRpcTestHarness } from "./rpc-harness";

describe("project router", () => {
  it("creates a project named after the folder, dedupes by path, and lists it", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "pie-home-"));
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "pie-project-"));
    const h = await makeRpcTestHarness(home);
    try {
      const created = await h.client.project.create({ path: workspace });
      expect(created).toMatchObject({ name: path.basename(workspace), path: workspace });

      const again = await h.client.project.create({ path: workspace });
      expect(again.id).toBe(created.id);

      await expect(h.client.project.list()).resolves.toEqual([created]);
    } finally {
      await h.dispose();
    }
  });

  it("removes a project with no sessions", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "pie-home-"));
    const projectDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "pie-project-"));
    const h = await makeRpcTestHarness(home);
    try {
      const project = await h.client.project.create({ path: projectDirectory });
      const observer = await h.client.agent.session.subscribe({ scope: { kind: "global" } });

      await h.client.project.remove({ projectId: project.id });

      await expect(h.client.project.list()).resolves.toEqual([]);
      for await (const item of observer) {
        if (item.type !== "event" || item.event.type !== "project.deleted") continue;
        expect(item.event.projectId).toBe(project.id);
        break;
      }
    } finally {
      await h.dispose();
    }
  });
});
