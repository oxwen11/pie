import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import {
  isPluginId,
  listPanelPlugins,
  parsePanelManifest,
  pluginPanelUrl,
  resolvePluginFile,
} from "./panel";

describe("isPluginId", () => {
  it("accepts a simple id and rejects traversal", () => {
    expect(isPluginId("demo")).toBe(true);
    expect(isPluginId("my-plugin.v2")).toBe(true);
    expect(isPluginId("..")).toBe(false);
    expect(isPluginId("a/b")).toBe(false);
    expect(isPluginId(".hidden")).toBe(false);
  });
});

describe("resolvePluginFile", () => {
  const pluginsDir = "/tmp/pie-home/plugins";

  it("maps a panel url onto the plugin directory", () => {
    expect(resolvePluginFile(pluginsDir, "/plugins/demo/index.html")).toBe(
      path.resolve(pluginsDir, "demo", "index.html"),
    );
  });

  it("rejects a missing entry, a bad id, and path escape", () => {
    expect(resolvePluginFile(pluginsDir, "/plugins/demo")).toBeNull();
    expect(resolvePluginFile(pluginsDir, "/plugins/../etc/passwd")).toBeNull();
    expect(resolvePluginFile(pluginsDir, "/plugins/demo/../../paths.ts")).toBeNull();
    expect(resolvePluginFile(pluginsDir, "/plugins/demo/%2e%2e/secret")).toBeNull();
  });
});

describe("parsePanelManifest", () => {
  it("reads title and optional entry and ignores the rest", () => {
    expect(parsePanelManifest({ title: "Demo", entry: "panel.html", permissions: [] })).toEqual({
      title: "Demo",
      entry: "panel.html",
    });
    expect(parsePanelManifest({ title: "Demo" })).toEqual({ title: "Demo", entry: undefined });
    expect(parsePanelManifest(null)).toBeNull();
  });
});

describe("listPanelPlugins", () => {
  it("discovers panel html, honors panel.json, and skips dirs without a panel", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "pie-plugins-"));
    const pluginsDir = path.join(home, "plugins");
    fs.mkdirSync(path.join(pluginsDir, "demo"), { recursive: true });
    fs.writeFileSync(path.join(pluginsDir, "demo", "index.html"), "<h1>Demo</h1>");
    fs.mkdirSync(path.join(pluginsDir, "named"), { recursive: true });
    fs.writeFileSync(
      path.join(pluginsDir, "named", "panel.json"),
      JSON.stringify({ title: "Named", entry: "panel.html" }),
    );
    fs.writeFileSync(path.join(pluginsDir, "named", "panel.html"), "<h1>Named</h1>");
    fs.mkdirSync(path.join(pluginsDir, "pi-only"), { recursive: true });
    fs.writeFileSync(path.join(pluginsDir, "pi-only", "extension.ts"), "export {}");

    const listed = await Effect.runPromise(
      listPanelPlugins(pluginsDir).pipe(Effect.provide(NodeFileSystem.layer)),
    );
    expect(listed).toEqual([
      { id: "demo", title: "demo", url: pluginPanelUrl("demo", "index.html") },
      { id: "named", title: "Named", url: pluginPanelUrl("named", "panel.html") },
    ]);
  });
});
