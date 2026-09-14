// @vitest-environment jsdom
import { SidebarProvider } from "@getpie/ui/components/sidebar";
import { domAnimation, LazyMotion } from "motion/react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Group } from "react-resizable-panels";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ResizablePanel } from "./resizable-panel";
import { ShellContentPanel, ShellGroup, ShellSidebarPanel } from "./shell-panels";
import { notifyUserLayoutListeners, resolveSidebarUserLayout } from "./shell-user-layout";

Object.assign(globalThis, {
  IS_REACT_ACT_ENVIRONMENT: true,
  ResizeObserver: class {
    disconnect(): void {
      /* jsdom has no layout */
    }
    observe(): void {
      /* jsdom has no layout */
    }
    unobserve(): void {
      /* jsdom has no layout */
    }
  },
});

window.matchMedia = (query) => ({
  addEventListener() {
    /* tests drive layout through notifyUserLayoutListeners */
  },
  addListener() {
    /* MediaQueryList still types this deprecated alias */
  },
  dispatchEvent: () => false,
  matches: false,
  media: query,
  onchange: null,
  removeEventListener() {
    /* tests drive layout through notifyUserLayoutListeners */
  },
  removeListener() {
    /* MediaQueryList still types this deprecated alias */
  },
});

let root: Root | undefined;
let container: HTMLDivElement | undefined;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
});

describe("shell panels", () => {
  it("keeps the settled sidebar drawer bound to the live panel width", () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    act(() => {
      root?.render(
        <SidebarProvider defaultOpen>
          <LazyMotion features={domAnimation}>
            <ShellGroup hasContentPanel={false} hasSidebar>
              <ShellSidebarPanel>
                <div>Sidebar</div>
              </ShellSidebarPanel>
              <ResizablePanel id="main">Main</ResizablePanel>
            </ShellGroup>
          </LazyMotion>
        </SidebarProvider>,
      );
    });

    const drawer = container.querySelector<HTMLElement>("[data-slot=sidebar-drawer]");

    expect(drawer?.dataset.state).toBe("open");
    expect(drawer?.style.width).toBe("100%");
    expect(drawer?.style.transform).toBe("none");
  });

  it("notifies width memory only for completed user layouts", () => {
    const listener = vi.fn<() => void>();
    const listeners = new Set([listener]);

    notifyUserLayoutListeners({ isUserInteraction: false }, listeners);
    expect(listener).not.toHaveBeenCalled();

    notifyUserLayoutListeners({ isUserInteraction: true }, listeners);
    expect(listener).toHaveBeenCalledOnce();
  });

  it("remembers expanded user widths and synchronizes user collapse state", () => {
    expect(resolveSidebarUserLayout(true, false, 360)).toEqual({ expandedWidth: 360 });
    expect(resolveSidebarUserLayout(true, true, 0)).toEqual({ open: false });
    expect(resolveSidebarUserLayout(false, false, 360)).toEqual({
      expandedWidth: 360,
      open: true,
    });
  });

  it("clips the resizable panel content wrapper", () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    act(() => {
      root?.render(
        <Group orientation="horizontal">
          <ShellContentPanel>
            <div>Content</div>
          </ShellContentPanel>
          <ResizablePanel id="filler" style={{ color: "red", overflow: "visible" }}>
            <div>Filler</div>
          </ResizablePanel>
        </Group>,
      );
    });

    const panel = container.querySelector<HTMLElement>("[data-testid=content]");
    const contentWrapper = panel?.firstElementChild as HTMLElement | null;
    const fillerWrapper = container.querySelector<HTMLElement>("[data-testid=filler]")
      ?.firstElementChild as HTMLElement | null;

    expect(panel?.parentElement?.dataset.group).toBe("true");
    expect(contentWrapper?.style.overflow).toBe("hidden");
    expect(fillerWrapper?.style.overflow).toBe("hidden");
    expect(fillerWrapper?.style.color).toBe("red");
  });
});
