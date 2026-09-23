// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

import { RendererVisibility } from "./renderer-visibility";

it("combines native minimization with document visibility and ignores blur", () => {
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  let nativeVisible = true;
  let changed = () => {};
  const unsubscribe = vi.fn<() => void>();
  const visibility = new RendererVisibility({
    getSnapshot: () => nativeVisible,
    subscribe: (listener) => {
      changed = listener;
      return unsubscribe;
    },
  });
  const listener = vi.fn<() => void>();
  visibility.subscribe(listener);
  const stop = visibility.start();
  expect(visibility.getSnapshot()).toBe(true);
  window.dispatchEvent(new Event("blur"));
  expect(visibility.getSnapshot()).toBe(true);
  nativeVisible = false;
  changed();
  expect(visibility.getSnapshot()).toBe(false);
  nativeVisible = true;
  changed();
  expect(visibility.getSnapshot()).toBe(true);
  window.dispatchEvent(new Event("pagehide"));
  expect(visibility.getSnapshot()).toBe(false);
  window.dispatchEvent(new Event("pageshow"));
  expect(visibility.getSnapshot()).toBe(true);
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
  document.dispatchEvent(new Event("visibilitychange"));
  expect(visibility.getSnapshot()).toBe(false);
  stop();
  expect(unsubscribe).toHaveBeenCalledOnce();
});

describe("browser visibility", () => {
  it("starts without demand, including a hidden initial mount", () => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    const visibility = new RendererVisibility(undefined);
    expect(visibility.getSnapshot()).toBe(false);
    const stop = visibility.start();
    expect(visibility.getSnapshot()).toBe(false);
    stop();
  });
});
