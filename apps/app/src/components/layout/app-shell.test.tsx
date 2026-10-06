import { SidebarProvider } from "@getpie/ui/components/sidebar";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { domAnimation, LazyMotion } from "motion/react";
import { expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";

import "@/index.css";
import { PlatformProvider } from "@/platform-provider";

import { AppShellBody, AppShellMain, AppShellSessionPanel, AppShellSidebar } from "./app-shell";
import { ContentPanel } from "./content-panel/model/content-panel";
import { ContentPanelSessionProvider } from "./content-panel/react/session-provider";
import type { AnyPanelView } from "./content-panel/react/view";

it("keeps one bordered inset frame around the sidebar and main when the sidebar collapses", async () => {
  await page.viewport(1280, 800);
  const contentPanel = new ContentPanel<AnyPanelView>();
  const root = createRootRoute({
    component: () => (
      <PlatformProvider
        value={{
          os: "macos",
          windowChrome: { titlebarHeight: 44, toggleInset: 88 },
        }}
      >
        <SidebarProvider className="h-svh overflow-hidden" defaultOpen>
          <LazyMotion features={domAnimation}>
            <ContentPanelSessionProvider contentPanel={contentPanel} sessionRef={null}>
              <AppShellBody>
                <AppShellSidebar>
                  <div>Session list</div>
                </AppShellSidebar>
                <AppShellMain>
                  <main>Main canvas</main>
                </AppShellMain>
              </AppShellBody>
            </ContentPanelSessionProvider>
          </LazyMotion>
        </SidebarProvider>
      </PlatformProvider>
    ),
  });
  const draft = createRoute({ getParentRoute: () => root, path: "/draft", component: () => null });
  const router = createRouter({
    routeTree: root.addChildren([draft]),
    history: createMemoryHistory({ initialEntries: ["/draft"] }),
  });
  await router.load();
  await render(<RouterProvider router={router} />);

  const frame = document.querySelector('[data-slot="shell-panel"]');
  expect(frame).toBeInstanceOf(HTMLElement);
  if (!(frame instanceof HTMLElement)) throw new Error("Missing shared shell panel");
  expect(frame.contains(page.getByText("Session list").element())).toBe(true);
  expect(frame.contains(page.getByText("Main canvas").element())).toBe(true);
  expect(frame.contains(page.getByRole("navigation").element())).toBe(false);
  expect(getComputedStyle(frame).borderTopWidth).toBe("1px");
  expect(parseFloat(getComputedStyle(frame).borderTopLeftRadius)).toBeGreaterThan(0);
  const before = frame.getBoundingClientRect();
  expect(before.x).toBe(52);
  expect(before.y).toBe(44);
  expect(before.right).toBe(1276);
  expect(before.bottom).toBe(796);

  const toggle = page.getByRole("button", { name: "Toggle Sidebar" });
  const toggleBounds = toggle.element().getBoundingClientRect();
  expect(toggleBounds.left).toBe(88);
  expect(toggleBounds.top + toggleBounds.height / 2).toBe(22);
  const titlebar = toggle.element().closest("header");
  if (!titlebar) throw new Error("Missing desktop titlebar");
  expect(toggleBounds.top + toggleBounds.height / 2).toBe(
    (titlebar.getBoundingClientRect().top + before.top) / 2,
  );
  const title = document.querySelector('[data-slot="shell-title"]');
  const drawer = document.querySelector('[data-slot="sidebar-drawer"]');
  if (!(title instanceof HTMLElement) || !(drawer instanceof HTMLElement)) {
    throw new Error("Missing title slot or sidebar");
  }
  expect(title.getBoundingClientRect().left).toBe(
    52 + drawer.getBoundingClientRect().width + 1 + 8,
  );
  const marker = document.createElement("span");
  marker.textContent = "Chat";
  marker.dataset.appShellTitlebarContent = "";
  title.append(marker);
  const rule = titlebar.querySelector(".bg-border");
  if (!(rule instanceof HTMLElement)) throw new Error("Missing titlebar rule");
  expect(getComputedStyle(rule).display).not.toBe("none");
  expect(rule.getBoundingClientRect().left).toBe(52 + drawer.getBoundingClientRect().width);

  await toggle.click();
  await expect
    .poll(
      () => document.querySelector('[data-slot="sidebar-drawer"]')?.getBoundingClientRect().width,
    )
    .toBe(0);
  const after = frame.getBoundingClientRect();
  expect([after.x, after.y, after.width, after.height]).toEqual([
    before.x,
    before.y,
    before.width,
    before.height,
  ]);
  expect(getComputedStyle(frame).borderTopWidth).toBe("1px");
  await expect
    .poll(() => title.getBoundingClientRect().left)
    .toBe(toggle.element().getBoundingClientRect().right + 8);
});

it("places the content-panel tab strip in the titlebar above the panel column", async () => {
  await page.viewport(1280, 800);
  const contentPanel = new ContentPanel<AnyPanelView>();
  const sessionRef = {
    environmentId: "env-1",
    ref: { projectId: "11111111-1111-4111-8111-111111111111", sessionId: "session-1" },
  };
  contentPanel.setPresentation(sessionRef, "docked");
  const root = createRootRoute({
    component: () => (
      <PlatformProvider
        value={{ os: "macos", windowChrome: { titlebarHeight: 44, toggleInset: 88 } }}
      >
        <SidebarProvider className="h-svh overflow-hidden" defaultOpen>
          <LazyMotion features={domAnimation}>
            <ContentPanelSessionProvider contentPanel={contentPanel} sessionRef={sessionRef}>
              <AppShellBody>
                <AppShellSidebar>
                  <div>Session list</div>
                </AppShellSidebar>
                <AppShellMain>
                  <main>Main canvas</main>
                </AppShellMain>
                <AppShellSessionPanel />
              </AppShellBody>
            </ContentPanelSessionProvider>
          </LazyMotion>
        </SidebarProvider>
      </PlatformProvider>
    ),
  });
  const router = createRouter({
    routeTree: root,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  await render(<RouterProvider router={router} />);

  const maximize = page.getByRole("button", { name: "Maximize panel" });
  await expect.element(maximize).toBeVisible();
  const titlebar = maximize.element().closest("header");
  const column = document.querySelector('[data-slot="content-panel-column"]');
  const slot = document.querySelector('[data-slot="shell-content-title"]');
  if (!titlebar || !(column instanceof HTMLElement) || !(slot instanceof HTMLElement)) {
    throw new Error("Missing titlebar, panel column or content title slot");
  }
  expect(column.contains(maximize.element())).toBe(false);
  await expect
    .poll(() => slot.getBoundingClientRect().left)
    .toBe(column.getBoundingClientRect().left);
  const toggle = page.getByRole("button", { name: "Toggle content panel" }).element();
  expect(slot.getBoundingClientRect().right).toBe(toggle.getBoundingClientRect().left - 8);
  const title = document.querySelector('[data-slot="shell-title"]');
  if (!(title instanceof HTMLElement)) throw new Error("Missing title slot");
  expect(title.getBoundingClientRect().right).toBeLessThanOrEqual(
    slot.getBoundingClientRect().left,
  );
  const rule = getComputedStyle(slot, "::before");
  expect(rule.width).toBe("1px");
  expect(rule.left).toBe("-1px");

  await maximize.click();
  await expect.poll(() => getComputedStyle(title).display).toBe("none");
  expect(getComputedStyle(slot, "::before").display).toBe("none");
  await expect
    .poll(() => slot.getBoundingClientRect().left)
    .toBe(column.getBoundingClientRect().left);
});
