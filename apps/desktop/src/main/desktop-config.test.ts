import { describe, expect, it } from "vitest";

import { buildDesktopConfig } from "./desktop-config";

describe("buildDesktopConfig", () => {
  it("resolves the packaged server entry under resourcesPath", () => {
    const config = buildDesktopConfig({
      isPackaged: true,
      resourcesPath: "/Applications/Pie.app/Contents/Resources",
      devUrl: undefined,
      desktopConfigFile: "/tmp/pie/Desktop.toml",
    });

    expect(config.serverEntry).toBe(
      "/Applications/Pie.app/Contents/Resources/app.asar/node_modules/@getpie/server/dist/server.mjs",
    );
    expect(config.desktopConfigFile).toBe("/tmp/pie/Desktop.toml");
  });

  it("resolves the dev server entry relative to the package output", () => {
    const config = buildDesktopConfig({
      isPackaged: false,
      resourcesPath: "/unused",
      devUrl: undefined,
      desktopConfigFile: "/tmp/pie/Desktop.toml",
    });

    expect(config.serverEntry).toMatch(/packages\/server\/dist\/server\.mjs$/);
  });
});
