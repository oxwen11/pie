import type { PieClientContext } from "@getpie/client";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from "@getpie/ui/components/sidebar";
import type { ClientLink } from "@orpc/client";
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

const unexpectedLink: ClientLink<PieClientContext> = {
  call: async () => {
    throw new Error("Unexpected RPC call");
  },
};

async function renderMenu(localLink = unexpectedLink) {
  const queryClient = new QueryClient();
  const environmentRpc = createEnvironmentRpc({
    localId: "local",
    queryClient,
    localLink,
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
  return { queryClient, orpc: environmentRpc.for("local") };
}

it("Reload calls session.reload and invalidates Pi-derived queries", async () => {
  const calls: Array<ReadonlyArray<string>> = [];
  const { queryClient, orpc } = await renderMenu({
    call: async (path) => {
      calls.push(path);
      return undefined;
    },
  });
  const modelsKey = orpc.agent.listModels.queryOptions({
    input: { projectId: "project" },
  }).queryKey;
  const commandsKey = orpc.agent.commands.queryOptions({
    input: { projectId: "project" },
  }).queryKey;
  queryClient.setQueryData(modelsKey, { models: [] });
  queryClient.setQueryData(commandsKey, []);

  await page.getByRole("button", { name: "First session", exact: true }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Reload" }).click();

  await expect.poll(() => calls).toContainEqual(["session", "reload"]);
  await expect.poll(() => queryClient.getQueryState(modelsKey)?.isInvalidated).toBe(true);
  await expect.poll(() => queryClient.getQueryState(commandsKey)?.isInvalidated).toBe(true);
});

it("hides Archive after mouse selection leaves the row, but keeps it available to keyboard focus", async () => {
  await page.viewport(1280, 800);
  await renderMenu();

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
