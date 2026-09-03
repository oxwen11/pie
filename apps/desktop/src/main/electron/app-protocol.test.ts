import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import url from "node:url";

import { describe, expect, it, vi } from "vitest";

import { createAppRequestHandler, type FetchAsset, resolveAssetPath } from "./app-protocol";

const ROOT = path.resolve("/app/renderer");

describe("resolveAssetPath", () => {
  it("resolves a file inside the renderer root", () => {
    expect(resolveAssetPath(ROOT, "/assets/index.js")).toBe(path.join(ROOT, "assets", "index.js"));
  });

  it("resolves the root path", () => {
    expect(resolveAssetPath(ROOT, "/")).toBe(ROOT);
  });

  it("decodes percent-encoded paths", () => {
    expect(resolveAssetPath(ROOT, "/assets/a%20b.js")).toBe(path.join(ROOT, "assets", "a b.js"));
  });

  it("refuses to escape the renderer root", () => {
    expect(resolveAssetPath(ROOT, "/../../etc/passwd")).toBeNull();
  });

  it("refuses an encoded traversal", () => {
    expect(resolveAssetPath(ROOT, "/%2e%2e/%2e%2e/etc/passwd")).toBeNull();
  });

  it("returns null for malformed percent encoding", () => {
    expect(resolveAssetPath(ROOT, "/broken%2")).toBeNull();
  });
});

describe("createAppRequestHandler", () => {
  it("serves a renderer asset without an RPC dispatch path", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pie-renderer-"));
    const asset = path.join(root, "asset.js");
    fs.writeFileSync(asset, "asset");
    const fetch = vi.fn<FetchAsset>(async () => new Response("asset"));

    const response = await createAppRequestHandler(root, fetch)(new Request("pie://app/asset.js"));

    await expect(response.text()).resolves.toBe("asset");
    expect(fetch).toHaveBeenCalledWith(url.pathToFileURL(asset).toString());
  });

  it("falls back to the SPA entry for an unknown renderer path", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pie-renderer-"));
    const entry = path.join(root, "index.html");
    fs.writeFileSync(entry, "app");
    const fetch = vi.fn<FetchAsset>(async () => new Response("app"));

    const response = await createAppRequestHandler(
      root,
      fetch,
    )(new Request("pie://app/chat/session"));

    await expect(response.text()).resolves.toBe("app");
    expect(fetch).toHaveBeenCalledWith(url.pathToFileURL(entry).toString());
  });

  it("rejects a different custom-protocol host", async () => {
    const fetch = vi.fn<FetchAsset>(async () => new Response("asset"));
    const response = await createAppRequestHandler(
      ROOT,
      fetch,
    )(new Request("pie://other/asset.js"));

    expect(response.status).toBe(404);
    expect(fetch).not.toHaveBeenCalled();
  });
});
