import { describe, expect, it } from "vitest";

import { ShellLayout } from "./shell-layout";

const storage = (): Storage => {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: () => null,
    removeItem: (key) => {
      data.delete(key);
    },
    setItem: (key, value) => {
      data.set(key, value);
    },
  };
};

describe("ShellLayout", () => {
  it("remembers sidebar width and per-session content width", () => {
    const disk = storage();
    const layout = new ShellLayout(disk);
    layout.setSidebarWidth(400);
    layout.setContentWidth("session-a", 320);
    layout.setContentWidth("session-b", 480);
    layout.persist();

    expect(layout.store.getState().sidebarWidth).toBe(400);
    expect(layout.store.getState().contentBySession).toEqual({
      "session-a": 320,
      "session-b": 480,
    });

    const restored = new ShellLayout(disk);
    expect(restored.store.getState().sidebarWidth).toBe(400);
    expect(restored.store.getState().contentBySession["session-a"]).toBe(320);
    expect(restored.store.getState().contentBySession["session-b"]).toBe(480);
  });

  it("does not persist until persist() is called", () => {
    const disk = storage();
    const layout = new ShellLayout(disk);
    layout.setSidebarWidth(360);
    expect(new ShellLayout(disk).store.getState().sidebarWidth).toBe(256);
    layout.persist();
    expect(new ShellLayout(disk).store.getState().sidebarWidth).toBe(360);
  });
});
