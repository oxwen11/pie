import { describe, expect, it } from "vitest";

import {
  desktopCollapsedCardInsetClass,
  desktopSidebarBrandInsetClass,
  desktopToggleInsetClass,
  MACOS_TOGGLE_LEFT_PX,
  shellTitlebarContentLeftPx,
} from "./components/layout/shell-chrome";
import type { Platform } from "./platform";

describe("shell-chrome", () => {
  const desktopMacos: Platform = { os: "macos" };
  const desktopLinux: Platform = { os: "linux" };

  it("places the macOS toggle beyond the traffic-light hit area", () => {
    expect(MACOS_TOGGLE_LEFT_PX).toBe(96);
    expect(desktopToggleInsetClass(desktopMacos)).toBe("ms-[96px]");
    expect(shellTitlebarContentLeftPx(desktopMacos)).toBe(132);
  });

  it("offsets sidebar brand past the fixed toggle on desktop win/linux", () => {
    expect(desktopToggleInsetClass(desktopLinux)).toBe("ms-1.5");
    expect(shellTitlebarContentLeftPx(desktopLinux)).toBe(42);
    expect(desktopSidebarBrandInsetClass(desktopLinux)).toBe("ms-[36px]");
  });

  it("reserves collapsed card-header space for the fixed toggle only", () => {
    expect(desktopCollapsedCardInsetClass(desktopMacos)).toBe("ps-[132px]");
    expect(desktopCollapsedCardInsetClass(desktopLinux)).toBe("ps-[42px]");
  });
});
