import { describe, expect, it } from "vitest";

import type { Platform } from "./platform";
import {
  desktopCollapsedCardInsetClass,
  desktopToggleInsetClass,
  MACOS_TOGGLE_LEFT_PX,
  showsBrandInFixedChrome,
} from "./components/layout/shell-chrome";

describe("shell-chrome", () => {
  const desktopMacos: Platform = { os: "macos" };
  const desktopLinux: Platform = { os: "linux" };

  it("places the macOS toggle immediately after traffic lights", () => {
    expect(MACOS_TOGGLE_LEFT_PX).toBe(78);
    expect(desktopToggleInsetClass(desktopMacos)).toBe("ms-[78px]");
    expect(showsBrandInFixedChrome(desktopMacos)).toBe(false);
  });

  it("pins BrandMark beside the toggle on desktop win/linux", () => {
    expect(desktopToggleInsetClass(desktopLinux)).toBe("ms-1.5");
    expect(showsBrandInFixedChrome(desktopLinux)).toBe(true);
  });

  it("reserves collapsed card-header space for fixed chrome", () => {
    expect(desktopCollapsedCardInsetClass(desktopMacos)).toBe("ps-[114px]");
    expect(desktopCollapsedCardInsetClass(desktopLinux)).toBe("ps-[98px]");
  });
});
