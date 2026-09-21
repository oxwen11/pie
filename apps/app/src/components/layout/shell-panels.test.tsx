import { SidebarProvider } from "@getpie/ui/components/sidebar";
import { domAnimation, LazyMotion } from "motion/react";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";

import { ResizablePanel } from "./resizable-panel";
import { ShellContentPanel, ShellGroup, ShellSidebarPanel } from "./shell-panels";
import { notifyUserLayoutListeners } from "./shell-user-layout";

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

describe("shell panels", () => {
  it("keeps the settled sidebar drawer bound to the live panel width", async () => {
    await render(
      <SidebarProvider defaultOpen>
        <LazyMotion features={domAnimation}>
          <div className="flex" style={{ width: 1200, height: 400 }}>
            <ShellSidebarPanel>
              <div>Sidebar</div>
            </ShellSidebarPanel>
            <ShellGroup hasContentPanel={false}>
              <ResizablePanel id="main">Main</ResizablePanel>
            </ShellGroup>
          </div>
        </LazyMotion>
      </SidebarProvider>,
    );

    await expect.element(page.getByText("Sidebar")).toBeVisible();
    const drawer = page.getByText("Sidebar").element().closest("[data-slot=sidebar-drawer]");
    expect(drawer).toBeInstanceOf(HTMLElement);
    expect((drawer as HTMLElement).dataset.state).toBe("open");
    expect((drawer as HTMLElement).getBoundingClientRect().width).toBeGreaterThan(100);
  });

  it("notifies width memory only for completed user layouts", () => {
    const listener = vi.fn<() => void>();
    const listeners = new Set([listener]);

    notifyUserLayoutListeners({ isUserInteraction: false }, listeners);
    expect(listener).not.toHaveBeenCalled();

    notifyUserLayoutListeners({ isUserInteraction: true }, listeners);
    expect(listener).toHaveBeenCalledOnce();
  });

  it("clips the resizable panel content wrapper", async () => {
    await render(
      <ShellGroup hasContentPanel>
        <ResizablePanel id="main" style={{ color: "red", overflow: "visible" }}>
          <div>Filler</div>
        </ResizablePanel>
        <ShellContentPanel>
          <div>Content</div>
        </ShellContentPanel>
      </ShellGroup>,
    );

    const panel = page.getByTestId("content").element();
    const contentWrapper = panel.firstElementChild as HTMLElement | null;
    const fillerWrapper = page.getByTestId("main").element()
      .firstElementChild as HTMLElement | null;

    expect(panel.parentElement?.dataset.group).toBe("true");
    expect(contentWrapper?.style.overflow).toBe("hidden");
    expect(fillerWrapper?.style.overflow).toBe("hidden");
    expect(fillerWrapper?.style.color).toBe("red");
  });

  it("keeps sidebar width when the content panel collapses", async () => {
    for (const key of Object.keys(localStorage)) {
      if (key.includes("pie:shell-layout") || key === "pie:sidebar-width")
        localStorage.removeItem(key);
    }

    function Shell({ contentOpen }: { contentOpen: boolean }) {
      return (
        <SidebarProvider defaultOpen>
          <LazyMotion features={domAnimation}>
            <div className="flex" style={{ width: 1200, height: 400 }}>
              <ShellSidebarPanel>
                <div>Sidebar</div>
              </ShellSidebarPanel>
              <ShellGroup hasContentPanel>
                <ResizablePanel id="main">Main</ResizablePanel>
                <ShellContentPanel collapsed={!contentOpen}>
                  {contentOpen ? <div>Content</div> : null}
                </ShellContentPanel>
              </ShellGroup>
            </div>
          </LazyMotion>
        </SidebarProvider>
      );
    }

    const drawerWidth = (): number => {
      const drawer = page.getByText("Sidebar").element().closest("[data-slot=sidebar-drawer]");
      expect(drawer).toBeInstanceOf(HTMLElement);
      return (drawer as HTMLElement).getBoundingClientRect().width;
    };

    const screen = await render(<Shell contentOpen={false} />);
    await expect.element(page.getByText("Sidebar")).toBeVisible();
    const hiddenWidth = drawerWidth();
    expect(hiddenWidth).toBeGreaterThan(100);

    await screen.rerender(<Shell contentOpen />);
    await expect
      .poll(() => page.getByTestId("content").element().getBoundingClientRect().width)
      .toBeGreaterThan(100);
    expect(drawerWidth()).toBeCloseTo(hiddenWidth, 0);

    await screen.rerender(<Shell contentOpen={false} />);
    await expect.element(page.getByText("Sidebar")).toBeVisible();
    expect(drawerWidth()).toBeCloseTo(hiddenWidth, 0);
  });
});
