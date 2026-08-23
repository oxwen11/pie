import { describe, expect, it } from "vitest";

import type { Platform } from "./platform";
import {
  DESKTOP_SIDEBAR_BRAND_INSET_CLASS,
  desktopTitlebarChromeInsetClass,
  desktopToggleInsetClass,
  MACOS_TOGGLE_LEFT_PX,
} from "./components/layout/shell-chrome";

describe("shell-chrome", () => {
  const desktopMacos: Platform = { os: "macos" };
  const desktopLinux: Platform = { os: "linux" };

  it("places the macOS toggle immediately after traffic lights", () => {
    expect(MACOS_TOGGLE_LEFT_PX).toBe(78);
    expect(desktopToggleInsetClass(desktopMacos)).toBe("ms-[78px]");
  });

  it("places the win/linux toggle on the shell gutter", () => {
    expect(desktopToggleInsetClass(desktopLinux)).toBe("ms-1.5");
  });

  it("reserves card-header space for a fixed toggle when collapsed", () => {
    expect(desktopTitlebarChromeInsetClass(desktopMacos)).toBe("ps-[114px]");
    expect(desktopTitlebarChromeInsetClass(desktopLinux)).toBe("ps-[42px]");
  });

  it("indents sidebar BrandMark past the fixed toggle", () => {
    expect(DESKTOP_SIDEBAR_BRAND_INSET_CLASS).toBe("ps-[42px]");
  });
});
