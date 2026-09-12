import { describe, expect, it } from "vitest";

import { applyPackagedPiRuntime, buildDesktopConfig } from "./desktop-config";

describe("buildDesktopConfig", () => {
  it("resolves the packaged server entry under resourcesPath", () => {
    const config = buildDesktopConfig({
      isPackaged: true,
      resourcesPath: "/Applications/Pie.app/Contents/Resources",
      devUrl: undefined,
    });

    expect(config.serverEntry).toBe(
      "/Applications/Pie.app/Contents/Resources/app.asar/node_modules/@getpie/server/dist/server.mjs",
    );
    expect(config.resourcesPath).toBe("/Applications/Pie.app/Contents/Resources");
  });

  it("resolves the dev server entry relative to the package output", () => {
    const config = buildDesktopConfig({
      isPackaged: false,
      resourcesPath: "/unused",
      devUrl: undefined,
    });

    expect(config.serverEntry).toMatch(/packages\/server\/dist\/server\.mjs$/);
    expect(config.resourcesPath).toBe("/unused");
  });
});

describe("applyPackagedPiRuntime", () => {
  const bundled = {
    isPackaged: true,
    bundledBun: "/Resources/vendor/bun",
    bundledRpc: "/Resources/pi-rpc/pi-rpc.js",
  } as const;

  it("leaves unpackaged env unchanged", () => {
    const env = { PATH: "/usr/bin" };
    expect(applyPackagedPiRuntime(env, { ...bundled, isPackaged: false })).toEqual(env);
  });

  it("points packaged desktop at the shipped bun and pi-rpc", () => {
    expect(applyPackagedPiRuntime({ PATH: "/usr/bin" }, bundled)).toEqual({
      PATH: "/usr/bin",
      PIE_BUN: "/Resources/vendor/bun",
      PIE_PI_EXECUTABLE: "/Resources/pi-rpc/pi-rpc.js",
    });
  });

  it("keeps a launch-time PIE_BUN override", () => {
    expect(
      applyPackagedPiRuntime({ PIE_BUN: "/custom/bun", PIE_HOME: "/tmp/pie" }, bundled),
    ).toEqual({
      PIE_BUN: "/custom/bun",
      PIE_HOME: "/tmp/pie",
      PIE_PI_EXECUTABLE: "/Resources/pi-rpc/pi-rpc.js",
    });
  });

  it("does not invent PIE_BUN when the binary is missing", () => {
    const env = { PATH: "/usr/bin" };
    expect(
      applyPackagedPiRuntime(env, {
        isPackaged: true,
        bundledBun: undefined,
        bundledRpc: undefined,
      }),
    ).toEqual(env);
  });
});
