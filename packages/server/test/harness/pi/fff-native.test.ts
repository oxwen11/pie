import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { vendorFffDirectory } from "../../../src/config/paths";
import { isBundledFffEnabled, shouldLoadBundledFff } from "../../../src/harness/pi/fff";
import {
  applyFffNativeEnvInPlace,
  FFF_NATIVE_VERSION,
  fffNativeChildEnv,
  fffNativeTarget,
  nodeModulesFromLibPath,
  resolveFffNativeLib,
  type FffNativeTarget,
} from "../../../src/harness/pi/fff-native";

const linuxX64 = fffNativeTarget("linux", "x64");
if (linuxX64 === undefined) {
  throw new Error("expected locked linux-x64 fff target");
}
const LINUX_X64: FffNativeTarget = linuxX64;

const writeCachedLib = (home: string, target: FffNativeTarget = LINUX_X64): string => {
  const cache = vendorFffDirectory(home);
  const pkg = path.join(cache, "node_modules", ...target.packageName.split("/"));
  fs.mkdirSync(pkg, { recursive: true });
  const lib = path.join(pkg, target.libFile);
  fs.writeFileSync(lib, "native");
  fs.writeFileSync(
    path.join(cache, "manifest.json"),
    `${JSON.stringify({
      version: FFF_NATIVE_VERSION,
      platform: target.platform,
      arch: target.arch,
      package: target.packageName,
      lib: target.libFile,
      integrity: target.integrity,
      shasum: target.shasum,
    })}\n`,
  );
  return lib;
};

describe("resolveFffNativeLib", () => {
  it("prefers an existing FFF_BUN_LIB file", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "pie-fff-native-"));
    const override = path.join(home, "override.so");
    fs.writeFileSync(override, "override");
    const resolved = resolveFffNativeLib({
      env: { FFF_BUN_LIB: override, PIE_HOME: home },
      home,
      platform: "linux",
      arch: "x64",
    });
    expect(resolved?.libPath).toBe(override);
  });

  it("ignores FFF_BUN_LIB when the file is missing and falls through to cache", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "pie-fff-native-"));
    const lib = writeCachedLib(home);
    const resolved = resolveFffNativeLib({
      env: { FFF_BUN_LIB: path.join(home, "missing.so"), PIE_HOME: home },
      home,
      platform: "linux",
      arch: "x64",
    });
    expect(resolved?.libPath).toBe(lib);
  });

  it("reads a matching cache manifest", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "pie-fff-native-"));
    const lib = writeCachedLib(home);
    const resolved = resolveFffNativeLib({
      env: { PIE_HOME: home },
      home,
      platform: "linux",
      arch: "x64",
    });
    expect(resolved).toEqual({
      libPath: lib,
      nodeModules: path.join(vendorFffDirectory(home), "node_modules"),
    });
  });

  it("rejects a cache whose version does not match", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "pie-fff-native-"));
    const lib = writeCachedLib(home);
    fs.writeFileSync(
      path.join(vendorFffDirectory(home), "manifest.json"),
      `${JSON.stringify({
        version: "0.0.1",
        platform: LINUX_X64.platform,
        arch: LINUX_X64.arch,
        package: LINUX_X64.packageName,
        lib: LINUX_X64.libFile,
        integrity: LINUX_X64.integrity,
        shasum: LINUX_X64.shasum,
      })}\n`,
    );
    expect(
      resolveFffNativeLib({
        env: { PIE_HOME: home },
        home,
        platform: "linux",
        arch: "x64",
      }),
    ).toBeUndefined();
    expect(fs.existsSync(lib)).toBe(true);
  });

  it("still attaches nodeModules after the daemon sets FFF_BUN_LIB onto the cache file", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "pie-fff-native-"));
    const lib = writeCachedLib(home);
    const resolved = resolveFffNativeLib({
      env: { PIE_HOME: home, FFF_BUN_LIB: lib },
      home,
      platform: "linux",
      arch: "x64",
    });
    expect(resolved).toEqual({
      libPath: lib,
      nodeModules: path.join(vendorFffDirectory(home), "node_modules"),
    });
  });
});

describe("fffNativeChildEnv", () => {
  it("does not set FFF_BUN_LIB when the cache is empty", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "pie-fff-native-"));
    expect(fffNativeChildEnv({ PIE_HOME: home })).toBeUndefined();
  });

  it("sets FFF_BUN_LIB and prepends NODE_PATH for the child", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "pie-fff-native-"));
    const host = fffNativeTarget();
    if (host === undefined) return;
    const lib = writeCachedLib(home, host);
    const env = fffNativeChildEnv({ PIE_HOME: home, NODE_PATH: "/other" });
    expect(env?.FFF_BUN_LIB).toBe(lib);
    expect(
      env?.NODE_PATH?.startsWith(
        `${path.join(vendorFffDirectory(home), "node_modules")}${path.delimiter}`,
      ),
    ).toBe(true);
  });

  it("keeps NODE_PATH when FFF_BUN_LIB is already set on the daemon env", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "pie-fff-native-"));
    const host = fffNativeTarget();
    if (host === undefined) return;
    const lib = writeCachedLib(home, host);
    const env = fffNativeChildEnv({ PIE_HOME: home, FFF_BUN_LIB: lib });
    expect(env?.FFF_BUN_LIB).toBe(lib);
    expect(env?.NODE_PATH).toBe(path.join(vendorFffDirectory(home), "node_modules"));
  });

  it("applyFffNativeEnvInPlace does not mutate the parent when the cache is empty", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "pie-fff-native-"));
    const env: NodeJS.ProcessEnv = { PIE_HOME: home };
    applyFffNativeEnvInPlace(env);
    expect(env.FFF_BUN_LIB).toBeUndefined();
    expect(env.NODE_PATH).toBeUndefined();
  });
});

describe("shouldLoadBundledFff", () => {
  it("stays off when the kill switch is unset but the native lib is missing", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "pie-fff-native-"));
    expect(isBundledFffEnabled({})).toBe(true);
    expect(shouldLoadBundledFff({ PIE_HOME: home }, { home, platform: "linux", arch: "x64" })).toBe(
      false,
    );
  });

  it("turns on once the native lib is cached", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "pie-fff-native-"));
    writeCachedLib(home);
    expect(shouldLoadBundledFff({ PIE_HOME: home }, { home, platform: "linux", arch: "x64" })).toBe(
      true,
    );
  });

  it("stays off under PIE_FFF=0 even when the cache is warm", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "pie-fff-native-"));
    writeCachedLib(home);
    expect(
      shouldLoadBundledFff(
        { PIE_HOME: home, PIE_FFF: "0" },
        { home, platform: "linux", arch: "x64" },
      ),
    ).toBe(false);
  });
});

describe("fffNativeTarget", () => {
  it("locks linux to the gnu package", () => {
    expect(fffNativeTarget("linux", "x64")?.packageName).toBe("@ff-labs/fff-bin-linux-x64-gnu");
    expect(fffNativeTarget("linux", "arm64")?.packageName).toBe("@ff-labs/fff-bin-linux-arm64-gnu");
    expect(fffNativeTarget("linux", "x64")?.tarball).toContain(
      `fff-bin-linux-x64-gnu-${FFF_NATIVE_VERSION}.tgz`,
    );
    expect(fffNativeTarget("linux", "x64")?.integrity.startsWith("sha512-")).toBe(true);
  });

  it("returns undefined for an unsupported target", () => {
    expect(fffNativeTarget("freebsd", "x64")).toBeUndefined();
  });
});

describe("nodeModulesFromLibPath", () => {
  it("walks up to the node_modules directory", () => {
    expect(
      nodeModulesFromLibPath(
        "/tmp/vendor/fff/node_modules/@ff-labs/fff-bin-linux-x64-gnu/libfff_c.so",
      ),
    ).toBe("/tmp/vendor/fff/node_modules");
  });
});
