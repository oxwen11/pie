import { SidebarProvider } from "@getpie/ui/components/sidebar";
import { domAnimation, LazyMotion } from "motion/react";
import { Group } from "react-resizable-panels";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";

import { ResizablePanel } from "./resizable-panel";
import { ShellContentPanel, ShellGroup, ShellSidebarPanel } from "./shell-panels";
import { notifyUserLayoutListeners, resolveSidebarUserLayout } from "./shell-user-layout";

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
          <ShellGroup hasContentPanel={false} hasSidebar>
            <ShellSidebarPanel>
              <div>Sidebar</div>
            </ShellSidebarPanel>
            <ResizablePanel id="main">Main</ResizablePanel>
          </ShellGroup>
        </LazyMotion>
      </SidebarProvider>,
    );

    await expect.element(page.getByText("Sidebar")).toBeVisible();
    const drawer = page.getByText("Sidebar").element().closest("[data-slot=sidebar-drawer]");
    expect(drawer).toBeInstanceOf(HTMLElement);
    expect((drawer as HTMLElement).dataset.state).toBe("open");
    expect((drawer as HTMLElement).style.width).toBe("100%");
    expect((drawer as HTMLElement).style.transform).toBe("none");
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

  it("clips the resizable panel content wrapper", async () => {
    await render(
      <Group orientation="horizontal">
        <ShellContentPanel>
          <div>Content</div>
        </ShellContentPanel>
        <ResizablePanel id="filler" style={{ color: "red", overflow: "visible" }}>
          <div>Filler</div>
        </ResizablePanel>
      </Group>,
    );

    const panel = page.getByTestId("content").element();
    const contentWrapper = panel.firstElementChild as HTMLElement | null;
    const fillerWrapper = page.getByTestId("filler").element()
      .firstElementChild as HTMLElement | null;

    expect(panel.parentElement?.dataset.group).toBe("true");
    expect(contentWrapper?.style.overflow).toBe("hidden");
    expect(fillerWrapper?.style.overflow).toBe("hidden");
    expect(fillerWrapper?.style.color).toBe("red");
  });
});
