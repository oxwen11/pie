import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { makePackageService } from "../src/packages";
import { makeRpcTestHarness } from "./rpc-harness";

describe("packages router", () => {
  it("lists empty, adds a source to ~/.pi settings, then removes it", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "pie-home-"));
    const settingsFile = path.join(home, "pi-agent", "settings.json");
    const h = await makeRpcTestHarness(home);
    try {
      await expect(h.client.packages.list()).resolves.toEqual([]);

      await expect(h.client.packages.add({ source: "npm:@foo/bar@1.0.0" })).resolves.toEqual({
        source: "npm:@foo/bar@1.0.0",
        installed: false,
      });
      await expect(h.client.packages.list()).resolves.toEqual([
        { source: "npm:@foo/bar@1.0.0", installed: false },
      ]);
      expect(JSON.parse(fs.readFileSync(settingsFile, "utf8")).packages).toEqual([
        "npm:@foo/bar@1.0.0",
      ]);

      await expect(h.client.packages.remove({ source: "npm:@foo/bar@1.0.0" })).resolves.toEqual({
        removed: true,
      });
      await expect(h.client.packages.list()).resolves.toEqual([]);
    } finally {
      await h.dispose();
    }
  });

  it("fails when removing an unknown source", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "pie-home-"));
    const h = await makeRpcTestHarness(home);
    try {
      await expect(h.client.packages.remove({ source: "npm:@missing/pkg" })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    } finally {
      await h.dispose();
    }
  });

  it("does not resolve add before settings persistence succeeds", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "pie-home-"));
    const blockedAgentDir = path.join(home, "blocked-agent-dir");
    fs.writeFileSync(blockedAgentDir, "not a directory");
    const svc = makePackageService(() => blockedAgentDir);

    await expect(Effect.runPromise(svc.add("npm:pi-example"))).rejects.toMatchObject({
      _tag: "InvalidPackageSource",
    });
  });

  it("searches the npm pi-package catalog with pagination", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "pie-home-"));
    const seen = new URLSearchParams();
    const fetchImpl: typeof fetch = (input) => {
      const url = new URL(input instanceof Request ? input.url : input);
      for (const [key, value] of url.searchParams) seen.set(key, value);
      return Promise.resolve(
        Response.json({
          total: 120,
          objects: [
            {
              downloads: { monthly: 1234 },
              package: {
                name: "pi-mcp-adapter",
                version: "2.0.0",
                description: "MCP adapter",
                publisher: { username: "nicopreme" },
              },
            },
          ],
        }),
      );
    };
    const svc = makePackageService(() => path.join(home, "pi-agent"), fetchImpl);
    await expect(Effect.runPromise(svc.search({ query: "mcp", page: 2 }))).resolves.toEqual({
      total: 120,
      page: 2,
      pageSize: 50,
      items: [
        {
          name: "pi-mcp-adapter",
          version: "2.0.0",
          source: "npm:pi-mcp-adapter",
          description: "MCP adapter",
          publisher: "nicopreme",
          downloadsMonthly: 1234,
        },
      ],
    });
    expect(seen.get("text")).toBe("mcp keywords:pi-package");
    expect(seen.get("size")).toBe("50");
    expect(seen.get("from")).toBe("50");
  });
});
