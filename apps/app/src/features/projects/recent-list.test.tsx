import type { PieClientContext } from "@getpie/client";
import { SidebarProvider } from "@getpie/ui/components/sidebar";
import type { ClientLink } from "@orpc/client";
import { QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRouteWithContext,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import type { ReactNode } from "react";
import { expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";

import { PullRequestDemandProvider } from "@/components/layout/pull-request-demand-provider";
import { createEnvironmentRpc } from "@/lib/environment-rpc";
import { createAppQueryClient } from "@/lib/orpc";
import type { Platform } from "@/platform";
import { PlatformProvider } from "@/platform-provider";

import { RecentList } from "./recent-list";

const LOCAL_PROJECT = "11111111-1111-4111-8111-111111111111";
const REMOTE_PROJECT = "22222222-2222-4222-8222-222222222222";

type Call = { readonly environmentId?: string; readonly path: string };

function link(calls: Call[]): ClientLink<PieClientContext> {
  return {
    call: async (path, _input, options) => {
      const joined = path.join(".");
      const environmentId = options.context?.environmentId;
      calls.push({ environmentId, path: joined });
      if (joined === "project.list") {
        return environmentId === "env-remote"
          ? [
              {
                id: REMOTE_PROJECT,
                name: "Remote",
                path: "/tmp/remote",
                createdAt: "2026-09-02T00:00:00.000Z",
                type: "chat",
              },
            ]
          : [
              {
                id: LOCAL_PROJECT,
                name: "Local",
                path: "/tmp/local",
                createdAt: "2026-09-01T00:00:00.000Z",
                type: "chat",
              },
            ];
      }
      if (joined === "agent.session.list") {
        return environmentId === "env-remote"
          ? [
              {
                projectId: REMOTE_PROJECT,
                sessionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
                title: "Remote chat",
                archived: false,
                createdAt: "2026-09-02T00:00:00.000Z",
                historyAvailable: true,
              },
            ]
          : [
              {
                projectId: LOCAL_PROJECT,
                sessionId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
                title: "Local chat",
                archived: false,
                createdAt: "2026-09-01T00:00:00.000Z",
                historyAvailable: true,
              },
            ];
      }
      if (joined === "schedule.list" || joined === "pullRequest.statuses") return [];
      if (joined === "pullRequest.demand") {
        return { leaseId: "lease", expiresAt: "2099-01-01T00:00:00.000Z" };
      }
      if (joined === "agent.session.subscribe") {
        return (async function* events() {
          yield* [];
          await new Promise<void>((resolve) => {
            options.signal?.addEventListener("abort", () => resolve(), { once: true });
          });
        })();
      }
      throw new Error(`Unexpected call: ${joined}`);
    },
  };
}

function shell(children: ReactNode, calls: Call[]): ReactNode {
  const queryClient = createAppQueryClient();
  const remote = {
    httpBaseUrl: "http://127.0.0.1:5001",
    wsBaseUrl: "ws://127.0.0.1:5001",
    token: "tok",
  };
  const environmentRpc = createEnvironmentRpc({
    localId: "env-local",
    localLink: link(calls),
    queryClient,
    resolveRemote: (id) => (id === "env-remote" ? remote : undefined),
    createRemoteLink: () => link(calls),
  });
  const snapshot = {
    revision: 1,
    connecting: [],
    remotes: [
      {
        id: "remote-1",
        environmentId: "env-remote",
        label: "remote",
        alias: "dinq@macbook-pro:22",
        connection: remote,
      },
    ],
  };
  const platform: Platform = {
    hostname: "this-mac",
    ssh: {
      client: { available: true },
      environments: {
        getSnapshot: () => snapshot,
        subscribe: () => () => undefined,
      },
      discoverHosts: () => Promise.resolve([]),
      connect: () => Promise.resolve(),
      remove: () => Promise.resolve(),
    },
  };
  const context = { localEnvironmentId: "env-local", environmentRpc };
  const routeTree = createRootRouteWithContext<typeof context>()({
    component: () => (
      <PlatformProvider value={platform}>
        <SidebarProvider>
          <PullRequestDemandProvider>{children}</PullRequestDemandProvider>
        </SidebarProvider>
      </PlatformProvider>
    ),
  });
  const router = createRouter({ routeTree, context, history: createMemoryHistory() });
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}

it("lists chat sessions from every connected Environment", async () => {
  const calls: Call[] = [];
  await render(shell(<RecentList />, calls));

  await expect.element(page.getByText("Local chat")).toBeVisible();
  await expect.element(page.getByText("Remote chat")).toBeVisible();
  await expect.element(page.getByText("macbook-pro")).toBeVisible();
  expect(calls).toEqual(
    expect.arrayContaining([{ environmentId: "env-remote", path: "agent.session.list" }]),
  );
});
