import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { makeRpcTestHarness } from "./rpc-harness";

describe("settings router", () => {
  it("returns defaults, then persists an update to config.json", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "pie-home-"));
    const h = await makeRpcTestHarness(home);
    try {
      const missing = await h.client.settings.get();
      expect(missing).toEqual({
        path: path.join(home, "config.json"),
        settings: { ui: { theme: "system" } },
      });
      expect(fs.existsSync(missing.path)).toBe(false);

      const saved = await h.client.settings.update({ ui: { theme: "dark" } });
      expect(saved.settings.ui.theme).toBe("dark");
      expect(JSON.parse(fs.readFileSync(saved.path, "utf8"))).toEqual({ ui: { theme: "dark" } });

      await expect(h.client.settings.get()).resolves.toEqual(saved);
    } finally {
      await h.dispose();
    }
  });

  it("maps an invalid theme in the file to INVALID_ARGUMENT", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "pie-home-"));
    fs.writeFileSync(path.join(home, "config.json"), '{"ui":{"theme":"sepia"}}\n');
    const h = await makeRpcTestHarness(home);
    try {
      await expect(h.client.settings.get()).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    } finally {
      await h.dispose();
    }
  });
});
