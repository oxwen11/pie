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

import { AppShellBody, AppShellMain, AppShellSidebar } from "./app-shell";
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
});
