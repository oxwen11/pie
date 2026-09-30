import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from "@getpie/ui/components/sidebar";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRouteWithContext,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { page, userEvent } from "vitest/browser";

import { createEnvironmentRpc } from "@/lib/environment-rpc";

import "@/index.css";

import { SessionActionsMenu } from "./session-actions-menu";

it("hides Archive after mouse selection leaves the row, but keeps it available to keyboard focus", async () => {
  await page.viewport(1280, 800);
  const queryClient = new QueryClient();
  const environmentRpc = createEnvironmentRpc({
    localId: "local",
    queryClient,
    localLink: {
      call: async () => {
        throw new Error("Unexpected RPC call");
      },
    },
    resolveRemote: () => undefined,
  });
  const context = { localEnvironmentId: "local", environmentRpc };
  const routeTree = createRootRouteWithContext<typeof context>()({
    component: () => (
      <SidebarProvider>
        <SidebarMenu className="w-64">
          <SidebarMenuItem>
            <SessionActionsMenu
              environmentId="local"
              isActive={() => false}
              render={<SidebarMenuButton />}
              session={{
                projectId: "project",
                sessionId: "session",
                title: "First session",
                archived: false,
                createdAt: "2026-09-01T00:00:00Z",
                historyAvailable: true,
              }}
            >
              First session
            </SessionActionsMenu>
          </SidebarMenuItem>
        </SidebarMenu>
        <button type="button">Outside the row</button>
      </SidebarProvider>
    ),
  });
  const router = createRouter({ routeTree, context, history: createMemoryHistory() });
  await router.load();
  await render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );

  const row = page.getByRole("button", { name: "First session", exact: true });
  const archive = page.getByRole("button", { name: "Archive", exact: true });
  const opacity = () => getComputedStyle(archive.element()).opacity;
  await row.hover();
  await expect.poll(opacity).toBe("1");
  await row.click();
  await page.getByRole("button", { name: "Outside the row" }).hover();
  await expect.element(row).toHaveFocus();
  await expect.poll(opacity).toBe("0");

  await userEvent.tab();
  await expect.element(archive).toHaveFocus();
  await expect.poll(opacity).toBe("1");
  await userEvent.tab({ shift: true });
  await expect.element(row).toHaveFocus();
  await expect.poll(opacity).toBe("1");

  await page.viewport(414, 896);
  await page.getByRole("button", { name: "Outside the row" }).click();
  await expect.poll(opacity).toBe("1");
});
