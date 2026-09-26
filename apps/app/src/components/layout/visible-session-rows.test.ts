// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";

import { VisibleSessionRows } from "./visible-session-rows";

afterEach(() => vi.unstubAllGlobals());

it("observes rows once and releases offscreen, collapsed, and unmounted rows without timers", () => {
  let notify: IntersectionObserverCallback = () => {};
  const observe = vi.fn<IntersectionObserver["observe"]>();
  const unobserve = vi.fn<IntersectionObserver["unobserve"]>();
  const disconnect = vi.fn<() => void>();
  const constructor = vi.fn<() => void>();
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(callback: IntersectionObserverCallback) {
        notify = callback;
        constructor();
      }
      observe = observe;
      unobserve = unobserve;
      disconnect = disconnect;
    },
  );
  const replace = vi.fn<ConstructorParameters<typeof VisibleSessionRows>[0]>();
  const rows = new VisibleSessionRows(replace);
  const stop = rows.start();
  const first = document.createElement("li");
  const second = document.createElement("li");
  const a = { projectId: "a", sessionId: "same" };
  const b = { projectId: "b", sessionId: "same" };
  const removeA = rows.observe(first, a);
  const removeB = rows.observe(second, b);
  const emit = (target: Element, isIntersecting: boolean) => {
    notify(
      [
        {
          target,
          isIntersecting,
          intersectionRect: { width: 100, height: 20 },
        } as IntersectionObserverEntry,
      ],
      {} as IntersectionObserver,
    );
  };
  emit(first, true);
  emit(second, true);
  expect(replace).toHaveBeenLastCalledWith([a, b]);
  emit(first, false);
  expect(replace).toHaveBeenLastCalledWith([b]);
  removeB();
  expect(replace).toHaveBeenLastCalledWith([]);
  removeA();
  stop();
  expect(constructor).toHaveBeenCalledOnce();
  expect(observe).toHaveBeenCalledTimes(2);
  expect(disconnect).toHaveBeenCalledOnce();
});
