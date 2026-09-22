import { SidebarProvider } from "@getpie/ui/components/sidebar";
import { domAnimation, LazyMotion } from "motion/react";
import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";

import "@/index.css";

import { ShellContentPanel } from "./shell-content";
import { ShellSidebarPanel } from "./shell-sidebar";

window.matchMedia = (query) => ({
  addEventListener() {
    /* tests drive layout through pointer / open state */
  },
  addListener() {
    /* MediaQueryList still types this deprecated alias */
  },
  dispatchEvent: () => false,
  matches: false,
  media: query,
  onchange: null,
  removeEventListener() {
    /* tests drive layout through pointer / open state */
  },
  removeListener() {
    /* MediaQueryList still types this deprecated alias */
  },
});

describe("shell columns", () => {
  it("keeps the session list open at a pixel width", async () => {
    await render(
      <SidebarProvider defaultOpen>
        <LazyMotion features={domAnimation}>
          <div className="flex" style={{ width: 1200, height: 400 }}>
            <ShellSidebarPanel>
              <div>Sidebar</div>
            </ShellSidebarPanel>
            <div className="min-w-0 flex-1">Main</div>
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

  it("keeps sidebar width when the content panel collapses", async () => {
    for (const key of Object.keys(localStorage)) {
      if (key === "pie:shell-layout") localStorage.removeItem(key);
    }

    function Shell({ contentOpen }: { contentOpen: boolean }) {
      return (
        <SidebarProvider defaultOpen>
          <LazyMotion features={domAnimation}>
            <div className="flex" style={{ width: 1200, height: 400 }}>
              <ShellSidebarPanel>
                <div>Sidebar</div>
              </ShellSidebarPanel>
              <div className="min-w-0 flex-1">Main</div>
              <ShellContentPanel collapsed={!contentOpen} maximized={false} sessionKey="s1">
                <div>Content</div>
              </ShellContentPanel>
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
      .poll(() => {
        const column = page
          .getByText("Content")
          .element()
          .closest("[data-slot=content-panel-column]");
        return column instanceof HTMLElement ? column.getBoundingClientRect().width : 0;
      })
      .toBeGreaterThan(100);
    expect(drawerWidth()).toBeCloseTo(hiddenWidth, 0);

    await screen.rerender(<Shell contentOpen={false} />);
    await expect.element(page.getByText("Sidebar")).toBeVisible();
    expect(drawerWidth()).toBeCloseTo(hiddenWidth, 0);
  });

  it("stops the content panel at the main column minimum", async () => {
    await render(
      <div data-testid="shell" className="flex" style={{ width: 800, height: 400 }}>
        <div data-testid="main" className="min-w-80 flex-1">
          Main
        </div>
        <ShellContentPanel collapsed={false} maximized={false} sessionKey="minimum-width">
          <div>Content</div>
        </ShellContentPanel>
      </div>,
    );

    const separator = page.getByRole("separator", { name: "Resize content panel" }).element();
    separator.setPointerCapture = () => {};
    const startX = separator.getBoundingClientRect().x;

    separator.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, clientX: startX, pointerId: 1 }),
    );
    separator.dispatchEvent(
      new PointerEvent("pointermove", { bubbles: true, clientX: 0, pointerId: 1 }),
    );
    separator.dispatchEvent(
      new PointerEvent("pointerup", { bubbles: true, clientX: 0, pointerId: 1 }),
    );

    const shell = page.getByTestId("shell").element();
    const main = page.getByTestId("main").element();
    const content = page.getByText("Content").element().closest("[data-slot=content-panel-column]");
    expect(content).toBeInstanceOf(HTMLElement);
    await expect.poll(() => main.getBoundingClientRect().width).toBe(320);
    expect((content as HTMLElement).getBoundingClientRect().right).toBeLessThanOrEqual(
      shell.getBoundingClientRect().right,
    );
  });
});
