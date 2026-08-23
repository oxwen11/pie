import { describe, expect, it } from "vitest";

import type { Platform } from "./platform";
import {
  DESKTOP_MACOS_TOGGLE_LEFT_CLASS,
  DESKTOP_SIDEBAR_BRAND_INSET_CLASS,
  DESKTOP_TOGGLE_LEFT_CLASS,
  desktopTitlebarChromeInsetClass,
} from "./components/layout/shell-chrome";

describe("shell-chrome", () => {
  const desktopMacos: Platform = { os: "macos" };
  const desktopLinux: Platform = { os: "linux" };

  it("places the macOS toggle immediately after traffic lights", () => {
    expect(DESKTOP_MACOS_TOGGLE_LEFT_CLASS).toBe("left-[78px]");
  });

  it("places the win/linux toggle on the shell gutter", () => {
    expect(DESKTOP_TOGGLE_LEFT_CLASS).toBe("left-1.5");
  });

  it("reserves card-header space for a fixed toggle when collapsed", () => {
    expect(desktopTitlebarChromeInsetClass(desktopMacos)).toBe("ps-[114px]");
    expect(desktopTitlebarChromeInsetClass(desktopLinux)).toBe("ps-[42px]");
  });

  it("indents sidebar BrandMark past the fixed toggle", () => {
    expect(DESKTOP_SIDEBAR_BRAND_INSET_CLASS).toBe("ps-[42px]");
  });
});
