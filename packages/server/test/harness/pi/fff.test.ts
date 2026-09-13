import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  applyBundledFffEnv,
  bundledFffCandidatesFromProcess,
  bundledFffExtensionFlags,
  isBundledFffEnabled,
  isPiFffExtensionPath,
  resolveBundledFffExtension,
  shouldLoadBundledFff,
  withoutUserInstalledPiFff,
} from "../../../src/harness/pi/fff";

describe("isBundledFffEnabled", () => {
  it("is on by default", () => {
    expect(isBundledFffEnabled({})).toBe(true);
    expect(isBundledFffEnabled({ PIE_FFF: "1" })).toBe(true);
  });

  it("treats PIE_FFF=0 as a kill switch only", () => {
    expect(isBundledFffEnabled({ PIE_FFF: "0" })).toBe(false);
    expect(isBundledFffEnabled({ PIE_FFF: "false" })).toBe(false);
  });
});

describe("shouldLoadBundledFff", () => {
  it("does not load the extension until a native lib is on disk", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "pie-fff-gate-"));
    expect(shouldLoadBundledFff({ PIE_HOME: home }, { home, platform: "linux", arch: "x64" })).toBe(
      false,
    );
  });
});

describe("applyBundledFffEnv", () => {
  it("defaults to override mode and no symlink follow", () => {
    expect(applyBundledFffEnv({})).toEqual({
      PI_FFF_MODE: "override",
      FFF_FOLLOW_SYMLINKS: "0",
    });
  });

  it("does not override a user-set mode or symlink flag", () => {
    expect(applyBundledFffEnv({ PI_FFF_MODE: "tools-only", FFF_FOLLOW_SYMLINKS: "1" })).toEqual({
      PI_FFF_MODE: "tools-only",
      FFF_FOLLOW_SYMLINKS: "1",
    });
  });
});

describe("bundledFffExtensionFlags", () => {
  it("maps defaults to override and follow-symlinks false", () => {
    expect(bundledFffExtensionFlags({})).toEqual(
      new Map<string, boolean | string>([
        ["fff-mode", "override"],
        ["fff-follow-symlinks", false],
      ]),
    );
  });
});

describe("resolveBundledFffExtension", () => {
  it("uses PIE_FFF_EXTENSION when that path exists", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pie-fff-"));
    const entry = path.join(root, "src", "index.ts");
    fs.mkdirSync(path.dirname(entry), { recursive: true });
    fs.writeFileSync(entry, "export default function fff() {}");
    expect(resolveBundledFffExtension({ env: { PIE_FFF_EXTENSION: entry } })).toBe(entry);
  });

  it("resolves a package dir that contains src/index.ts", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pie-fff-pkg-"));
    fs.mkdirSync(path.join(root, "src"), { recursive: true });
    fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "@ff-labs/pi-fff" }));
    fs.writeFileSync(path.join(root, "src", "index.ts"), "export default function fff() {}");
    expect(resolveBundledFffExtension({ env: { PIE_FFF_EXTENSION: root } })).toBe(
      path.join(root, "src", "index.ts"),
    );
  });

  it("finds the island next to pie-pi-process", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pie-fff-island-"));
    const processEntry = path.join(root, "pi-process", "pi-process.js");
    const index = path.join(root, "fff", "node_modules", "@ff-labs", "pi-fff", "src", "index.ts");
    fs.mkdirSync(path.dirname(processEntry), { recursive: true });
    fs.mkdirSync(path.dirname(index), { recursive: true });
    fs.writeFileSync(processEntry, "");
    fs.writeFileSync(
      path.join(root, "fff", "node_modules", "@ff-labs", "pi-fff", "package.json"),
      "{}",
    );
    fs.writeFileSync(index, "");
    expect(resolveBundledFffExtension({ processEntry, env: {} })).toBe(index);
  });

  it("returns undefined when nothing is shipped", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pie-fff-missing-"));
    const processEntry = path.join(root, "orphan", "pi-process.js");
    fs.mkdirSync(path.dirname(processEntry), { recursive: true });
    fs.writeFileSync(processEntry, "");
    expect(resolveBundledFffExtension({ processEntry, env: {} })).toBeUndefined();
  });
});

describe("bundledFffCandidatesFromProcess", () => {
  it("looks at sibling fff/ and vendor/fff/", () => {
    expect(bundledFffCandidatesFromProcess("/res/pi-process/pi-process.js")).toEqual([
      path.join("/res/pi-process", "..", "fff", "node_modules"),
      path.join("/res/pi-process", "..", "vendor", "fff", "node_modules"),
    ]);
  });
});

describe("isPiFffExtensionPath / withoutUserInstalledPiFff", () => {
  it("recognizes the scoped package path", () => {
    expect(isPiFffExtensionPath("/app/node_modules/@ff-labs/pi-fff/src/index.ts")).toBe(true);
    expect(isPiFffExtensionPath("/app/node_modules/@ff-labs/pi-fff")).toBe(true);
    expect(isPiFffExtensionPath("/app/node_modules/@ff-labs/other/src/index.ts")).toBe(false);
  });

  it("keeps the bundled copy and drops a user-installed one", () => {
    const bundled = "/opt/pie/fff/node_modules/@ff-labs/pi-fff/src/index.ts";
    const result = withoutUserInstalledPiFff(
      {
        extensions: [
          { path: bundled, resolvedPath: bundled },
          {
            path: "/home/me/.pi/agent/packages/@ff-labs/pi-fff/src/index.ts",
            resolvedPath: "/home/me/.pi/agent/packages/@ff-labs/pi-fff/src/index.ts",
          },
          { path: "/opt/pie/bash-inline", resolvedPath: "<inline:1>" },
        ],
        errors: [],
        runtime: { id: "keep" },
      },
      bundled,
    );
    expect(result.extensions).toEqual([
      { path: bundled, resolvedPath: bundled },
      { path: "/opt/pie/bash-inline", resolvedPath: "<inline:1>" },
    ]);
    expect(result.runtime).toEqual({ id: "keep" });
  });
});
