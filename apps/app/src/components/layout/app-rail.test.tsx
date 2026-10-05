import { SidebarProvider } from "@getpie/ui/components/sidebar";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { page, userEvent } from "vitest/browser";

import "@/index.css";
import { PlatformProvider } from "@/platform-provider";

import { AppRail } from "./app-rail";

it("spaces the rail buttons and shows right-side tooltips on hover and keyboard focus without losing link navigation", async () => {
  await page.viewport(1280, 800);
  const root = createRootRoute({
    component: () => (
      <PlatformProvider
        value={{ os: "macos", windowChrome: { titlebarHeight: 44, toggleInset: 88 } }}
      >
        <SidebarProvider className="h-svh">
          <AppRail />
          <main>
            <Outlet />
          </main>
        </SidebarProvider>
      </PlatformProvider>
    ),
  });
  const destinations = [
    ["/draft", "New chat"],
    ["/schedules", "Scheduled"],
    ["/pull-requests", "Pull requests"],
    ["/plugins", "Plugins"],
    ["/settings", "Settings"],
  ] as const;
  const router = createRouter({
    routeTree: root.addChildren(
      destinations.map(([path]) =>
        createRoute({
          getParentRoute: () => root,
          path,
          component: () => <p>{path}</p>,
        }),
      ),
    ),
    history: createMemoryHistory({ initialEntries: ["/draft"] }),
  });
  await router.load();
  await render(<RouterProvider router={router} />);

  const home = page.getByRole("link", { name: "New chat", exact: true });
  const scheduled = page.getByRole("link", { name: "Scheduled", exact: true });
  const homeBounds = home.element().getBoundingClientRect();
  expect(homeBounds.width).toBe(36);
  expect(homeBounds.height).toBe(36);
  expect(scheduled.element().getBoundingClientRect().top - homeBounds.bottom).toBe(8);

  await userEvent.tab();
  await expect.element(home).toHaveFocus();
  await expect.element(page.getByText("New chat", { exact: true })).toBeVisible();
  await userEvent.keyboard("{Escape}");
  await expect.element(page.getByText("New chat", { exact: true })).not.toBeInTheDocument();

  for (const [, label] of destinations) {
    const link = page.getByRole("link", { name: label, exact: true });
    expect(link.element().hasAttribute("title")).toBe(false);
    // Escape dismisses the tooltip without a pointerleave. Hover only reopens
    // after the pointer enters again, so leave the trigger first.
    await page.getByRole("main").hover();
    await link.hover();
    const tooltip = page.getByText(label, { exact: true });
    await expect.element(tooltip).toBeVisible();
    expect(tooltip.element().closest('[data-slot="tooltip-popup"]')).not.toBeNull();
    expect(tooltip.element().getBoundingClientRect().left).toBeGreaterThanOrEqual(
      link.element().getBoundingClientRect().right,
    );
  }
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await expect.poll(() => router.state.location.pathname).toBe("/settings");
  await expect
    .element(page.getByRole("link", { name: "Settings", exact: true }))
    .toHaveAttribute("aria-current", "page");
});

it("forwards tooltip trigger props to the web sidebar toggle", async () => {
  await page.viewport(1280, 800);
  const root = createRootRoute({
    component: () => (
      <PlatformProvider value={{}}>
        <SidebarProvider className="h-svh">
          <AppRail />
          <main>
            <Outlet />
          </main>
        </SidebarProvider>
      </PlatformProvider>
    ),
  });
  const draft = createRoute({
    getParentRoute: () => root,
    path: "/draft",
    component: () => <p>/draft</p>,
  });
  const router = createRouter({
    routeTree: root.addChildren([draft]),
    history: createMemoryHistory({ initialEntries: ["/draft"] }),
  });
  await router.load();
  await render(<RouterProvider router={router} />);

  const toggle = page.getByRole("button", { name: "Toggle Sidebar", exact: true });
  await page.getByRole("main").hover();
  await toggle.hover();
  const tooltip = page.getByText("Toggle sidebar", { exact: true });
  await expect.element(tooltip).toBeVisible();
  const popup = tooltip.element().closest('[data-slot="tooltip-popup"]');
  expect(popup).not.toBeNull();
  expect(Object.hasOwn(toggle.element().dataset, "baseUiTooltipTrigger")).toBe(true);
  expect(tooltip.element().getBoundingClientRect().left).toBeGreaterThanOrEqual(
    toggle.element().getBoundingClientRect().right,
  );

  await page.getByRole("main").hover();
  await expect.element(tooltip).not.toBeInTheDocument();
  await userEvent.tab();
  await expect.element(toggle).toHaveFocus();
  await expect.element(page.getByText("Toggle sidebar", { exact: true })).toBeVisible();
});
