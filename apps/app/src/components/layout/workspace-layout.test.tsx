// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  WorkspaceLayout,
  WorkspaceLayoutBody,
  WorkspaceLayoutPreview,
  WorkspaceLayoutSeparator,
  WorkspaceLayoutToolbar,
  WorkspaceLayoutTree,
  WorkspaceLayoutTreeTrigger,
} from "./workspace-layout";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

type ResizeObserverCallback = ConstructorParameters<typeof ResizeObserver>[0];

const observers: TestResizeObserver[] = [];
let mobile = false;
let width = 800;

class TestResizeObserver {
  readonly callback: ResizeObserverCallback;
  readonly disconnect = vi.fn<() => void>();
  target: Element | undefined;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    observers.push(this);
  }

  observe(target: Element): void {
    this.target = target;
  }
  unobserve(): void {}
}

Object.assign(globalThis, { ResizeObserver: TestResizeObserver });

window.matchMedia = (query) => ({
  addEventListener() {},
  addListener() {},
  dispatchEvent: () => false,
  matches: query.includes("max-width") && mobile,
  media: query,
  onchange: null,
  removeEventListener() {},
  removeListener() {},
});

let root: Root | undefined;
let container: HTMLDivElement | undefined;

beforeEach(() => {
  observers.length = 0;
  mobile = false;
  width = 800;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(() => ({
    bottom: 0,
    height: 0,
    left: 0,
    right: 0,
    toJSON: () => {},
    top: 0,
    width,
    x: 0,
    y: 0,
  }));
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  vi.restoreAllMocks();
  root = undefined;
  container = undefined;
});

function renderLayout(options?: { label?: string; toolbar?: boolean }): void {
  const label = options?.label ?? "Project";
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() =>
    root?.render(
      <WorkspaceLayout>
        {options?.toolbar ? (
          <WorkspaceLayoutToolbar>
            <div>Toolbar</div>
            <WorkspaceLayoutTreeTrigger label={label} />
          </WorkspaceLayoutToolbar>
        ) : null}
        <WorkspaceLayoutBody>
          <WorkspaceLayoutPreview>
            <div>Preview</div>
          </WorkspaceLayoutPreview>
          {options?.toolbar ? null : (
            <WorkspaceLayoutTreeTrigger className="absolute end-11 top-1.5 z-10" label={label} />
          )}
          <WorkspaceLayoutSeparator />
          <WorkspaceLayoutTree>
            <div>Tree</div>
          </WorkspaceLayoutTree>
        </WorkspaceLayoutBody>
      </WorkspaceLayout>,
    ),
  );
}

function fireResize(nextWidth: number): void {
  width = nextWidth;
  const observer = workspaceObserver();
  expect(observer).toBeDefined();
  if (observer === undefined) return;
  const entry = { contentRect: { width: nextWidth } } as ResizeObserverEntry;
  act(() => {
    observer.callback([entry], observer);
  });
}

function trigger(): HTMLButtonElement | null {
  return (
    container?.querySelector<HTMLButtonElement>("button[aria-label^='Open file tree for']") ?? null
  );
}

function workspaceObserver() {
  return observers.find((observer) => observer.target === container?.firstElementChild);
}

describe("WorkspaceLayout", () => {
  it("renders the split layout above the width threshold", () => {
    renderLayout();

    expect(trigger()).toBeNull();
    expect(container?.querySelector("[aria-label='Resize file tree']")).not.toBeNull();
    expect(container?.textContent?.indexOf("Preview")).toBeLessThan(
      container?.textContent?.indexOf("Tree") ?? -1,
    );
  });

  it("switches to a drawer below the width threshold", () => {
    width = 389;
    renderLayout({ label: "Workspace" });

    expect(trigger()?.getAttribute("aria-label")).toBe("Open file tree for Workspace");
    expect(container?.querySelector("[aria-label='Resize file tree']")).toBeNull();
  });

  it("keeps the split layout at exactly the threshold", () => {
    width = 24 * 16 + 6;
    renderLayout();

    expect(trigger()).toBeNull();
    expect(container?.querySelector("[aria-label='Resize file tree']")).not.toBeNull();
  });

  it("uses drawer mode on mobile even when the container is wide", () => {
    mobile = true;
    renderLayout({ label: "Mobile workspace" });

    expect(trigger()?.getAttribute("aria-label")).toBe("Open file tree for Mobile workspace");
  });

  it("keeps overlay and toolbar trigger placement explicit", () => {
    width = 389;
    renderLayout();
    expect(trigger()?.classList.contains("absolute")).toBe(true);

    act(() => root?.unmount());
    container?.remove();
    root = undefined;
    container = undefined;
    observers.length = 0;

    width = 389;
    renderLayout({ toolbar: true });
    expect(trigger()?.classList.contains("absolute")).toBe(false);
    expect(trigger()?.parentElement?.textContent).toContain("Toolbar");
  });

  it("opens the file tree sheet and preserves its accessible contract", () => {
    width = 389;
    renderLayout({ toolbar: true, label: "/src/index.ts" });

    const fileTreeTrigger = trigger();
    expect(fileTreeTrigger?.getAttribute("aria-expanded")).toBe("false");
    expect(fileTreeTrigger?.getAttribute("aria-haspopup")).toBe("dialog");
    const controls = fileTreeTrigger?.getAttribute("aria-controls");
    expect(controls).toBeTruthy();

    act(() => fileTreeTrigger?.click());

    expect(fileTreeTrigger?.getAttribute("aria-expanded")).toBe("true");
    expect(document.getElementById(controls ?? "")?.textContent).toContain("Project files");
  });

  it("closes the drawer when the layout crosses back to the split threshold", () => {
    width = 389;
    renderLayout({ toolbar: true });
    act(() => trigger()?.click());
    expect(trigger()?.getAttribute("aria-expanded")).toBe("true");

    fireResize(24 * 16 + 6);
    expect(trigger()).toBeNull();
    expect(container?.querySelector("[aria-label='Resize file tree']")).not.toBeNull();

    fireResize(389);
    expect(trigger()?.getAttribute("aria-expanded")).toBe("false");
  });

  it("disconnects its resize observer when unmounted", () => {
    renderLayout();
    const observer = workspaceObserver();

    act(() => root?.unmount());

    expect(observer?.disconnect).toHaveBeenCalledOnce();
  });
});
