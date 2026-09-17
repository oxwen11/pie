import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  applyDesktopRuntime,
  buildDesktopConfig,
  startsDesktopInBackground,
} from "./desktop-config";

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

describe("startsDesktopInBackground", () => {
  it("enables background mode for E2E and explicit background launches", () => {
    expect(startsDesktopInBackground({ PIE_E2E: "1" })).toBe(true);
    expect(startsDesktopInBackground({ PIE_DESKTOP_BACKGROUND: "1" })).toBe(true);
    expect(startsDesktopInBackground({ PIE_DESKTOP_BACKGROUND: "0" })).toBe(false);
    expect(startsDesktopInBackground({})).toBe(false);
  });
});

describe("applyDesktopRuntime", () => {
  const bundled = {
    isPackaged: true,
    bundledBun: "/Resources/vendor/bun",
  } as const;

  it("leaves unpackaged env unchanged", () => {
    const env = { PATH: "/usr/bin" };
    expect(applyDesktopRuntime(env, { ...bundled, isPackaged: false })).toEqual({
      PATH: "/usr/bin",
    });
  });

  it("prepends vendor to PATH so packaged desktop finds shipped bun", () => {
    expect(applyDesktopRuntime({ PATH: "/usr/bin", PIE_HOME: "/tmp/pie" }, bundled)).toEqual({
      PATH: `/Resources/vendor${path.delimiter}/usr/bin`,
      PIE_HOME: "/tmp/pie",
    });
  });

  it("sets PATH to vendor when packaged env has no PATH", () => {
    expect(applyDesktopRuntime({}, bundled)).toEqual({
      PATH: "/Resources/vendor",
    });
  });

  it("does not change PATH when the bundled bun is missing", () => {
    const env = { PATH: "/usr/bin" };
    expect(
      applyDesktopRuntime(env, {
        isPackaged: true,
        bundledBun: undefined,
      }),
    ).toEqual({ PATH: "/usr/bin" });
  });
});
