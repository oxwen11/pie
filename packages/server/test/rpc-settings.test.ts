import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { makeRpcTestHarness } from "./rpc-harness";

describe("settings router", () => {
  it("returns defaults without creating config.toml, then persists an update", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "pie-home-"));
    const h = await makeRpcTestHarness(home);
    try {
      const missing = await h.client.settings.get();
      expect(missing.exists).toBe(false);
      expect(missing.path).toBe(path.join(home, "config.toml"));
      expect(missing.settings).toEqual({
        version: 1,
        appearance: { theme: "system" },
      });
      expect(fs.existsSync(missing.path)).toBe(false);

      const written = await h.client.settings.update({
        version: 1,
        appearance: { theme: "dark" },
      });
      expect(written.exists).toBe(true);
      expect(written.settings.appearance.theme).toBe("dark");
      expect(fs.readFileSync(written.path, "utf8")).toContain('theme = "dark"');

      const again = await h.client.settings.get();
      expect(again.settings).toEqual(written.settings);
    } finally {
      await h.dispose();
    }
  });

  it("maps a corrupt config.toml to INVALID_ARGUMENT", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "pie-home-"));
    fs.writeFileSync(path.join(home, "config.toml"), "theme = [");
    const h = await makeRpcTestHarness(home);
    try {
      await expect(h.client.settings.get()).rejects.toMatchObject({
        code: "INVALID_ARGUMENT",
      });
    } finally {
      await h.dispose();
    }
  });
});
