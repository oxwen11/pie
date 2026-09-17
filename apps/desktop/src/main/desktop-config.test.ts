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
  });

  it("resolves the dev server entry relative to the package output", () => {
    const config = buildDesktopConfig({
      isPackaged: false,
      resourcesPath: "/unused",
      devUrl: undefined,
    });

    expect(config.serverEntry).toMatch(/packages\/server\/dist\/server\.mjs$/);
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
    bundledPiProcess: "/Resources/pi-process/pi-process.js",
  } as const;

  it("leaves unpackaged env unchanged", () => {
    const env = { PATH: "/usr/bin" };
    expect(applyDesktopRuntime(env, { ...bundled, isPackaged: false })).toEqual({
      PATH: "/usr/bin",
    });
  });

  it("points packaged desktop at the shipped bun and pie-pi-process", () => {
    expect(applyDesktopRuntime({ PATH: "/usr/bin" }, bundled)).toEqual({
      PATH: "/usr/bin",
      PIE_BUN: "/Resources/vendor/bun",
      PIE_PI_EXECUTABLE: "/Resources/pi-process/pi-process.js",
    });
  });

  it("keeps a launch-time PIE_BUN override", () => {
    expect(applyDesktopRuntime({ PIE_BUN: "/custom/bun", PIE_HOME: "/tmp/pie" }, bundled)).toEqual({
      PIE_BUN: "/custom/bun",
      PIE_HOME: "/tmp/pie",
      PIE_PI_EXECUTABLE: "/Resources/pi-process/pi-process.js",
    });
  });
});
