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

  it("allocates a folder under Paths.chatProjectsDir and lists the project", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "pie-home-"));
    const h = await makeRpcTestHarness(home);
    try {
      const created = await h.client.project.allocateChatProjectDir();
      expect(created.path.startsWith(path.join(home, "Pie") + path.sep)).toBe(true);
      expect(created.name).toMatch(/^Chat-\d+$/);
      expect(created.type).toBe("chat");
      expect(path.basename(created.path)).toBe(created.name);
      expect(path.basename(path.dirname(created.path))).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(fs.existsSync(created.path)).toBe(true);
      await expect(h.client.project.list()).resolves.toEqual([created]);
    } finally {
      await h.dispose();
    }
  });
});
