import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { pluginPanelUrl } from "../src/plugin";
import { makeRpcTestHarness } from "./rpc-harness";

describe("plugin router", () => {
  it("lists pie panel plugins from $PIE_HOME/plugins and skips dirs without a panel", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "pie-home-"));
    const demo = path.join(home, "plugins", "demo");
    fs.mkdirSync(demo, { recursive: true });
    fs.writeFileSync(path.join(demo, "index.html"), "<h1>Demo</h1>");
    fs.mkdirSync(path.join(home, "plugins", "dark"), { recursive: true });

    const h = await makeRpcTestHarness(home);
    try {
      await expect(h.client.plugin.list()).resolves.toEqual([
        { id: "demo", title: "demo", url: pluginPanelUrl("demo", "index.html") },
      ]);
    } finally {
      await h.dispose();
    }
  });
});
