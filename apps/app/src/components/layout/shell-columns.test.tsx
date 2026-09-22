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

  it("keeps the scrollbar inside the session list and the content seam at 1px", async () => {
    for (const key of Object.keys(localStorage)) {
      if (key === "pie:shell-layout") localStorage.removeItem(key);
    }

    await page.viewport(1280, 800);

    await render(
      <SidebarProvider defaultOpen>
        <LazyMotion features={domAnimation}>
          <div className="flex" style={{ width: 1200, height: 400 }}>
            <ShellSidebarPanel>
              <div>Sidebar</div>
            </ShellSidebarPanel>
            <div className="min-w-0 flex-1">Main</div>
            <ShellContentPanel collapsed={false} maximized={false} sessionKey="s1">
              <div>Content</div>
            </ShellContentPanel>
          </div>
        </LazyMotion>
      </SidebarProvider>,
    );

    await expect.element(page.getByText("Sidebar")).toBeVisible();

    const drawer = page.getByText("Sidebar").element().closest("[data-slot=sidebar-drawer]");
    expect(drawer).toBeInstanceOf(HTMLElement);
    const drawerBox = drawer as HTMLElement;
    const drawerInner = drawerBox.firstElementChild;
    expect(drawerInner).toBeInstanceOf(HTMLElement);
    // Padding lives inside the sized column. Outside it, overflow clips the scrollbar.
    expect((drawerInner as HTMLElement).getBoundingClientRect().right).toBeLessThanOrEqual(
      drawerBox.getBoundingClientRect().right + 0.5,
    );

    const column = page.getByText("Content").element().closest("[data-slot=content-panel-column]");
    expect(column).toBeInstanceOf(HTMLElement);
    const columnBox = column as HTMLElement;
    const columnInner = columnBox.firstElementChild;
    expect(columnInner).toBeInstanceOf(HTMLElement);
    expect((columnInner as HTMLElement).getBoundingClientRect().right).toBeLessThanOrEqual(
      columnBox.getBoundingClientRect().right + 0.5,
    );
    expect(getComputedStyle(columnInner as HTMLElement).paddingRight).toBe("4px");

    const seams = [...document.querySelectorAll<HTMLElement>('[role="separator"]')].filter(
      (el) => el.getBoundingClientRect().width > 0,
    );
    expect(seams.map((el) => el.getBoundingClientRect().width)).toEqual([4, 1]);
    const seam = seams[0];
    const box = seam.getBoundingClientRect();
    seam.dispatchEvent(
      new PointerEvent("pointermove", {
        bubbles: true,
        clientX: box.left + 6,
        clientY: box.top + 80,
        pointerId: 1,
      }),
    );
    const hit = seam.querySelector("[data-slot=shell-gutter-hit]");
    expect(hit).toBeInstanceOf(HTMLElement);
    expect((hit as HTMLElement).getBoundingClientRect().width).toBeGreaterThanOrEqual(64);
    const mark = seam.querySelector("span");
    expect(mark).toBeInstanceOf(HTMLElement);
    expect((mark as HTMLElement).style.left).toBe("6px");
    expect((mark as HTMLElement).style.top).toBe("80px");
    expect((mark as HTMLElement).style.opacity).toBe("1");
  });
});
