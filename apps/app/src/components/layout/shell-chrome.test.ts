import { describe, expect, it } from "vitest";

import type { Platform } from "@/platform";

import {
  MACOS_TOGGLE_LEFT_PX,
  shellProviderStyle,
  shellTitlebarContentLeftPx,
} from "./shell-chrome";

describe("shell-chrome", () => {
  const desktopMacos: Platform = { os: "macos" };
  const desktopLinux: Platform = { os: "linux" };

  it("places the macOS toggle beyond the traffic-light hit area", () => {
    expect(MACOS_TOGGLE_LEFT_PX).toBe(96);
    expect(shellTitlebarContentLeftPx(desktopMacos)).toBe(132);
    expect(shellProviderStyle(desktopMacos)).toEqual({
      "--shell-controls-left": "96px",
      "--shell-titlebar-content-left": "132px",
      "--shell-sidebar-brand-inset": "126px",
    });
  });

  it("offsets sidebar brand past the fixed toggle on desktop win/linux", () => {
    expect(shellTitlebarContentLeftPx(desktopLinux)).toBe(42);
    expect(shellProviderStyle(desktopLinux)).toEqual({
      "--shell-controls-left": "6px",
      "--shell-titlebar-content-left": "42px",
      "--shell-sidebar-brand-inset": "36px",
    });
  });

  it("does not set chrome vars on web", () => {
    expect(shellProviderStyle({})).toEqual({});
  });
});
