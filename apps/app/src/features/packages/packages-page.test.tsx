import type { PieClient } from "@getpie/client";
import { SidebarProvider } from "@getpie/ui/components/sidebar";
import { createORPCClient } from "@orpc/client";
import { QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";

import "@/index.css";
import { PageSidebarOutlet, PageSidebarProvider } from "@/components/layout/page-sidebar";
import { createAppQueryClient, createEnvironmentOrpc } from "@/lib/orpc";
import type { RouterAppContext } from "@/routes/__root";

import { PackagesPage } from "./packages-page";

it("renders one page title with Add beside it in both Packages and Skills, and preserves detail navigation", async () => {
  await page.viewport(1280, 800);
  const queryClient = createAppQueryClient();
  const client = createORPCClient<PieClient>({
    call: async () => {
      throw new Error("This layout check must not call the server");
    },
  });
  const orpc = createEnvironmentOrpc(client, "local", queryClient);
  queryClient.setQueryData(orpc.packages.list.queryOptions().queryKey, [
    { source: "npm:tool", installed: true },
  ]);
  queryClient.setQueryData(
    orpc.packages.search.queryOptions({ input: { query: "", page: 1 } }).queryKey,
    {
      items: [],
      total: 0,
      page: 1,
      pageSize: 50,
    },
  );
  queryClient.setQueryData(orpc.skills.list.queryOptions().queryKey, []);
  const root = createRootRouteWithContext<RouterAppContext>()({
    component: () => (
      <QueryClientProvider client={queryClient}>
        <SidebarProvider>
          <PageSidebarProvider>
            <aside className="w-64">
              <PageSidebarOutlet />
            </aside>
            <main className="flex flex-1 flex-col">
              <Outlet />
            </main>
          </PageSidebarProvider>
        </SidebarProvider>
      </QueryClientProvider>
    ),
  });
  const plugins = createRoute({
    getParentRoute: () => root,
    path: "/plugins",
    staticData: { pageSidebar: true },
    component: PackagesPage,
  });
  const router = createRouter({
    routeTree: root.addChildren([plugins]),
    history: createMemoryHistory({ initialEntries: ["/plugins"] }),
    context: {
      localEnvironmentId: "local",
      environmentRpc: {
        localId: "local",
        queryClient,
        for: () => orpc,
        httpBaseUrl: () => "http://127.0.0.1",
        sync: () => undefined,
      },
    },
  });
  await router.load();
  await render(<RouterProvider router={router} />);

  for (const title of ["Packages", "Skills"]) {
    await page.getByRole("button", { name: title, exact: true }).click();
    const heading = page.getByRole("heading", { name: title, exact: true });
    await expect.element(heading).toBeVisible();
    const labels = Array.from(document.querySelectorAll("main h1, main span")).filter(
      (element) => element.textContent === title,
    );
    expect(labels).toHaveLength(1);
    expect(
      heading
        .element()
        .parentElement?.parentElement?.contains(
          page.getByRole("button", { name: "Add", exact: true }).element(),
        ),
    ).toBe(true);
  }
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect.element(page.getByRole("textbox", { name: "Package source" })).toBeVisible();
  await page.getByRole("button", { name: "tool", exact: true }).click();
  await expect.element(page.getByRole("heading", { name: "tool", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Back to packages" }).click();
  await expect.element(page.getByRole("heading", { name: "Packages", exact: true })).toBeVisible();
  queryClient.clear();
});
