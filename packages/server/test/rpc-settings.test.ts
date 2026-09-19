import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { makeRpcTestHarness } from "./rpc-harness";

describe("settings router", () => {
  it("returns defaults without creating a file, then writes on update", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "pie-home-"));
    const settingsFile = path.join(home, "settings.json");
    const h = await makeRpcTestHarness(home);
    try {
      await expect(h.client.settings.get()).resolves.toEqual({
        appearance: { theme: "system" },
      });
      expect(fs.existsSync(settingsFile)).toBe(false);

      await expect(h.client.settings.update({ appearance: { theme: "dark" } })).resolves.toEqual({
        appearance: { theme: "dark" },
      });

      expect(JSON.parse(fs.readFileSync(settingsFile, "utf8"))).toEqual({
        appearance: { theme: "dark" },
      });
      await expect(h.client.settings.get()).resolves.toEqual({
        appearance: { theme: "dark" },
      });
    } finally {
      await h.dispose();
    }
  });

  it("fails loud on a corrupt settings file", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "pie-home-"));
    fs.writeFileSync(path.join(home, "settings.json"), "{");
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
