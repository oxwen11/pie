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

  it("allocates a folder under PIE_NEW_PROJECT_ROOT and lists the project", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "pie-home-"));
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pie-new-proj-"));
    const previous = process.env.PIE_NEW_PROJECT_ROOT;
    process.env.PIE_NEW_PROJECT_ROOT = root;
    const h = await makeRpcTestHarness(home);
    try {
      await expect(h.client.project.allocateRoot()).resolves.toEqual({ path: root });
      const created = await h.client.project.allocate({ title: "hello world" });
      expect(created.path.startsWith(root + path.sep)).toBe(true);
      expect(created.name).toMatch(/^\d{4}-\d{2}-\d{2}-hello-world$/);
      expect(fs.existsSync(created.path)).toBe(true);
      await expect(h.client.project.list()).resolves.toEqual([created]);
    } finally {
      if (previous === undefined) delete process.env.PIE_NEW_PROJECT_ROOT;
      else process.env.PIE_NEW_PROJECT_ROOT = previous;
      await h.dispose();
    }
  });
});
