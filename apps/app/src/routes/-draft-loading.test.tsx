import type { Project } from "@getpie/contract";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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

import { ChatManagerContext } from "@/features/chat/runtime/chat-context";
import { createEnvironmentRpc } from "@/lib/environment-rpc";
import type { EnvironmentSnapshot } from "@/platform";
import { PlatformProvider } from "@/platform-provider";
import { Route as DraftRoute } from "@/routes/draft";

import "@/index.css";

it.each(["resolve", "reject"])(
  "preserves the real draft editor while a newly connected Environment loads and %ss",
  async (outcome) => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const localProject: Project = {
      id: "local-project",
      name: "Local project",
      path: "/tmp/draft-loading-project",
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    let resolveRemote = (_projects: readonly Project[]): void => {};
    let rejectRemote = (_error: Error): void => {};
    const remoteProjects = new Promise<readonly Project[]>((resolve, reject) => {
      resolveRemote = resolve;
      rejectRemote = reject;
    });
    let snapshot: EnvironmentSnapshot = { revision: 0, connecting: [], remotes: [] };
    const listeners = new Set<(next: EnvironmentSnapshot) => void>();
    const connection = {
      httpBaseUrl: "http://127.0.0.1:1",
      wsBaseUrl: "ws://127.0.0.1:1",
      token: "test-only",
    };
    const environmentRpc = createEnvironmentRpc({
      localId: "local",
      queryClient,
      resolveRemote: () => connection,
      createRemoteLink: () => ({ call: async () => remoteProjects }),
      localLink: {
        call: async (path) => {
          switch (path.join(".")) {
            case "project.list":
              return [localProject];
            case "agent.listModels":
              return { models: [] };
            case "agent.commands":
              return [];
            case "git.branch":
              return { kind: "not-repository" };
            default:
              throw new Error(`Unexpected RPC: ${path.join(".")}`);
          }
        },
      },
    });
    const context = { localEnvironmentId: "local", environmentRpc };
    const root = createRootRouteWithContext<typeof context>()({
      component: () => (
        <PlatformProvider
          value={{
            ssh: {
              client: { available: true },
              environments: {
                getSnapshot: () => snapshot,
                subscribe: (listener) => {
                  listeners.add(listener);
                  return () => listeners.delete(listener);
                },
              },
              discoverHosts: async () => [],
              connect: async () => {},
              remove: async () => {},
            },
          }}
        >
          <ChatManagerContext
            value={{
              chatFor: () => {
                throw new Error("This test must not create a Session");
              },
            }}
          >
            <Outlet />
          </ChatManagerContext>
        </PlatformProvider>
      ),
    });
    const draft = createRoute({
      getParentRoute: () => root,
      path: "draft",
      component: DraftRoute.options.component,
      validateSearch: DraftRoute.options.validateSearch,
    });
    const router = createRouter({
      routeTree: root.addChildren([draft]),
      context,
      history: createMemoryHistory({ initialEntries: ["/draft?projectId=local-project"] }),
    });
    await router.load();
    const view = await render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
    try {
      const editor = page.getByRole("textbox", { name: "Message" });
      await editor.fill("Keep this unsent draft");
      const originalEditor = editor.element();
      const originalText = originalEditor.textContent ?? "";
      expect(originalText).toContain("Keep this unsent draft");
      snapshot = {
        revision: 1,
        connecting: [],
        remotes: [
          { id: "remote", environmentId: "remote", alias: "remote", label: "Remote", connection },
        ],
      };
      for (const listener of listeners) listener(snapshot);
      const remoteKey = environmentRpc.for("remote").project.list.queryOptions().queryKey;
      await expect.poll(() => queryClient.getQueryState(remoteKey)?.fetchStatus).toBe("fetching");
      await expect.element(editor).toHaveTextContent(originalText);
      expect(editor.element()).toBe(originalEditor);
      if (outcome === "resolve") resolveRemote([]);
      else rejectRemote(new Error("Remote unavailable"));
      await expect
        .poll(() => queryClient.getQueryState(remoteKey)?.status)
        .toBe(outcome === "resolve" ? "success" : "error");
      await expect.element(editor).toHaveTextContent(originalText);
      expect(editor.element()).toBe(originalEditor);
      expect(document.querySelector('button[type="submit"]')).not.toBeDisabled();
    } finally {
      resolveRemote([]);
      await view.unmount();
      queryClient.clear();
    }
  },
);
