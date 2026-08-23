import { describe, expect, it } from "vitest";

import type { Platform } from "./platform";
import { isDesktopHost, isDesktopMacosHost, isWebHost } from "./platform-host";

describe("platform-host", () => {
  const web: Platform = {};
  const desktopMacos: Platform = { os: "macos", quit: () => {} };
  const desktopLinux: Platform = { os: "linux", quit: () => {} };

  it("treats missing os as web", () => {
    expect(isWebHost(web)).toBe(true);
    expect(isDesktopHost(web)).toBe(false);
    expect(isDesktopMacosHost(web)).toBe(false);
  });

  it("treats any native os as desktop", () => {
    expect(isDesktopHost(desktopMacos)).toBe(true);
    expect(isDesktopHost(desktopLinux)).toBe(true);
    expect(isWebHost(desktopLinux)).toBe(false);
  });

  it("reserves traffic-light chrome for desktop macOS only", () => {
    expect(isDesktopMacosHost(desktopMacos)).toBe(true);
    expect(isDesktopMacosHost(desktopLinux)).toBe(false);
    expect(isDesktopMacosHost(web)).toBe(false);
  });
});
