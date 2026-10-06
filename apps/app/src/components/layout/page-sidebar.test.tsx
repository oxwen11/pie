import { SidebarProvider, useSidebar } from "@getpie/ui/components/sidebar";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { domAnimation, LazyMotion } from "motion/react";
import { useState } from "react";
import { expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";

import "@/index.css";
import { PlatformProvider } from "@/platform-provider";

import { AppShellBody, AppShellMain, AppShellSidebar } from "./app-shell";
import { AppSidebar } from "./app-sidebar";
import { ContentPanel } from "./content-panel/model/content-panel";
import { ContentPanelSessionProvider } from "./content-panel/react/session-provider";
import type { AnyPanelView } from "./content-panel/react/view";
import { PageSidebar, PageSidebarProvider } from "./page-sidebar";

function SectionPage({ title }: { readonly title: string }) {
  const [selected, setSelected] = useState(false);
  const { setOpenMobile } = useSidebar();
  return (
    <>
      <PageSidebar>
        <h2>{title} sidebar</h2>
        <button
          onClick={() => {
            setSelected(true);
            setOpenMobile(false);
          }}
          type="button"
        >
          Select item
        </button>
      </PageSidebar>
      <p>{selected ? "Selected item" : "No selection"}</p>
      <input aria-label="Page input" />
    </>
  );
}

it("switches the inner sidebar with the rail without duplicating it in main or remounting the page on collapse", async () => {
  await page.viewport(1280, 800);
  const contentPanel = new ContentPanel<AnyPanelView>();
  const root = createRootRoute({
    component: () => (
      <PlatformProvider
        value={{ os: "macos", windowChrome: { titlebarHeight: 44, toggleInset: 88 } }}
      >
        <SidebarProvider className="bg-sidebar h-svh overflow-hidden" defaultOpen>
          <LazyMotion features={domAnimation}>
            <ContentPanelSessionProvider contentPanel={contentPanel} sessionRef={null}>
              <PageSidebarProvider>
                <AppShellBody>
                  <AppShellSidebar>
                    <AppSidebar />
                  </AppShellSidebar>
                  <AppShellMain>
                    <main>
                      <Outlet />
                    </main>
                  </AppShellMain>
                </AppShellBody>
              </PageSidebarProvider>
            </ContentPanelSessionProvider>
          </LazyMotion>
        </SidebarProvider>
      </PlatformProvider>
    ),
  });
  const sections = [
    ["/plugins", "Plugins"],
    ["/schedules", "Scheduled"],
    ["/pull-requests", "Pull requests"],
    ["/settings", "Settings"],
    ["/inbox", "Inbox"],
  ] as const;
  const railSections = sections.filter(([path]) => path !== "/inbox");
  const router = createRouter({
    routeTree: root.addChildren(
      sections.map(([path, title]) =>
        createRoute({
          getParentRoute: () => root,
          path,
          staticData: { pageSidebar: true },
          component: () => <SectionPage title={title} />,
        }),
      ),
    ),
    history: createMemoryHistory({ initialEntries: ["/plugins"] }),
  });
  await router.load();
  await render(<RouterProvider router={router} />);

  const sidebar = document.querySelector('[data-slot="sidebar"]');
  const shell = document.querySelector('[data-slot="sidebar-wrapper"]');
  const frame = document.querySelector('[data-slot="shell-panel"]');
  if (sidebar === null || shell === null || frame === null)
    throw new Error("Missing shell surfaces");
  expect(getComputedStyle(sidebar).backgroundColor).toBe(getComputedStyle(frame).backgroundColor);
  expect(getComputedStyle(sidebar).backgroundColor).not.toBe(
    getComputedStyle(shell).backgroundColor,
  );

  for (const [, title] of railSections) {
    await page.getByRole("link", { name: title, exact: true }).click();
    const heading = page.getByRole("heading", { name: `${title} sidebar` });
    await expect.element(heading).toBeVisible();
    const slot = document.querySelector('[data-slot="page-sidebar"]');
    expect(slot?.contains(heading.element())).toBe(true);
    expect(document.querySelector("main")?.contains(heading.element())).toBe(false);
    expect(document.querySelectorAll('[data-slot="page-sidebar"] h2')).toHaveLength(1);
  }
  router.history.push("/inbox");
  await router.load();
  await expect.element(page.getByRole("heading", { name: "Inbox sidebar" })).toBeVisible();
  await router.navigate({ to: "/settings" });

  await page.getByRole("button", { name: "Select item" }).click();
  await expect.element(page.getByText("Selected item", { exact: true })).toBeVisible();
  await page.getByRole("textbox", { name: "Page input" }).fill("keep my input");
  await page.getByRole("button", { name: "Toggle Sidebar" }).click();
  await expect
    .poll(
      () => document.querySelector('[data-slot="sidebar-drawer"]')?.getBoundingClientRect().width,
    )
    .toBe(0);
  await page.getByRole("button", { name: "Toggle Sidebar" }).click();
  await expect.element(page.getByRole("heading", { name: "Settings sidebar" })).toBeVisible();
  await expect
    .element(page.getByRole("textbox", { name: "Page input" }))
    .toHaveValue("keep my input");
  await expect.element(page.getByText("Selected item", { exact: true })).toBeVisible();

  await page.viewport(390, 844);
  await page.getByRole("button", { name: "Toggle Sidebar" }).click();
  await expect.element(page.getByRole("heading", { name: "Settings sidebar" })).toBeVisible();
  expect(
    document
      .querySelector('[data-mobile="true"]')
      ?.contains(page.getByRole("heading", { name: "Settings sidebar" }).element()),
  ).toBe(true);
  await page.getByRole("button", { name: "Select item" }).click();
  await expect.element(page.getByRole("dialog", { name: "Sidebar" })).not.toBeInTheDocument();
  await expect
    .element(page.getByRole("textbox", { name: "Page input" }))
    .toHaveValue("keep my input");
});
