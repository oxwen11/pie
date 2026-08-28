import { describe, expect, it, vi } from "vitest";

import { applySidebarDrawerSize, readRemPx, sidebarDrawerLayout } from "./sidebar-drawer";

describe("sidebarDrawerLayout", () => {
  it("is fully open at progress 0", () => {
    expect(sidebarDrawerLayout(256, 0)).toEqual({ widthPx: 256, x: 0 });
  });

  it("is fully closed at progress 1", () => {
    expect(sidebarDrawerLayout(256, 1)).toEqual({ widthPx: 0, x: -256 });
  });

  it("slides the drawer and the reserved slot together", () => {
    expect(sidebarDrawerLayout(256, 0.5)).toEqual({ widthPx: 128, x: -128 });
  });

  it("clamps progress outside 0..1", () => {
    expect(sidebarDrawerLayout(256, -0.2)).toEqual({ widthPx: 256, x: 0 });
    expect(sidebarDrawerLayout(256, 1.4)).toEqual({ widthPx: 0, x: -256 });
  });

  it("stays closed when the expanded width is not positive", () => {
    expect(sidebarDrawerLayout(0, 0.3)).toEqual({ widthPx: 0, x: 0 });
    expect(sidebarDrawerLayout(-16, 0.3)).toEqual({ widthPx: 0, x: 0 });
  });
});

describe("applySidebarDrawerSize", () => {
  it("collapses once the spring reaches the closed edge", () => {
    const panel = {
      collapse: vi.fn<() => void>(),
      isCollapsed: vi.fn<() => boolean>(() => false),
      resize: vi.fn<(size: number | string) => void>(),
    };

    applySidebarDrawerSize(panel, 0);
    expect(panel.collapse).toHaveBeenCalledOnce();
    expect(panel.resize).not.toHaveBeenCalled();
  });

  it("does not collapse an already-collapsed panel", () => {
    const panel = {
      collapse: vi.fn<() => void>(),
      isCollapsed: vi.fn<() => boolean>(() => true),
      resize: vi.fn<(size: number | string) => void>(),
    };

    applySidebarDrawerSize(panel, 0.4);
    expect(panel.collapse).not.toHaveBeenCalled();
  });

  it("resizes in pixels while the drawer is in flight", () => {
    const panel = {
      collapse: vi.fn<() => void>(),
      isCollapsed: vi.fn<() => boolean>(() => false),
      resize: vi.fn<(size: number | string) => void>(),
    };

    applySidebarDrawerSize(panel, 180);
    expect(panel.resize).toHaveBeenCalledWith(180);
    expect(panel.collapse).not.toHaveBeenCalled();
  });
});

describe("readRemPx", () => {
  it("falls back to a 16px rem when no document is available", () => {
    expect(readRemPx(16)).toBe(256);
    expect(readRemPx(12)).toBe(192);
  });
});
