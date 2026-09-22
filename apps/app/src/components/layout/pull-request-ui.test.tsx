// @vitest-environment jsdom
import type {
  PullRequestRef,
  PullRequestSessionStatus,
  PullRequestSnapshot,
  PullRequestStackPreview,
  SessionPullRequestLink,
} from "@getpie/contract/pull-request";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRouteWithContext,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { SessionPullRequestIndicator } from "@/features/projects/session-pull-request-indicator";
import { pullRequestPanel } from "@/features/pull-request/pull-request-panel";
import { EnvironmentOrpcProvider } from "@/lib/environment-orpc";
import type { EnvironmentRpc } from "@/lib/environment-rpc";
import type { EnvironmentOrpc } from "@/lib/orpc";

const mockEnvironmentOrpc = (value: unknown): EnvironmentOrpc => {
  if (typeof value !== "object" || value === null) throw new Error("mock orpc");
  return value as EnvironmentOrpc;
};
import { PlatformProvider } from "@/platform-provider";

import { PullRequestDemandProvider } from "./pull-request-demand-provider";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const sessionRef = { projectId: "project", sessionId: "session" };
const environmentSession = { environmentId: "local", ref: sessionRef };
const ref = (number: number): PullRequestRef => ({
  host: "github.com",
  owner: "pie",
  repository: "pie",
  number,
});
const link = (number: number): SessionPullRequestLink => ({
  ref: ref(number),
  linkedAt: `2026-09-01T00:00:${number}Z`,
  source: "agent",
  excluded: false,
  snapshot: null,
  stack: null,
  stackCheckedAt: null,
});
const snapshot = (pullRequest: PullRequestRef): PullRequestSnapshot => ({
  ref: pullRequest,
  title: `Detail ${pullRequest.number}`,
  url: `https://github.com/pie/pie/pull/${pullRequest.number}`,
  head: { branch: `branch-${pullRequest.number}`, sha: "head" },
  baseBranch: "main",
  lifecycle: { type: "open", draft: false },
  mergeability: "mergeable",
  checks: { summary: "none", items: [] },
  reviewDecision: "none",
  autoMerge: null,
  offeredActions: [],
  updatedAt: "2026-09-01T00:00:00Z",
  body: "",
});
let root: Root;
let container: HTMLDivElement;
let queryClient: QueryClient;
let current: PullRequestSessionStatus;
const api = {
  demand: vi.fn<() => Promise<{ leaseId: string; expiresAt: string }>>(async () => ({
    leaseId: "lease",
    expiresAt: new Date(Date.now() + 90_000).toISOString(),
  })),
  statuses: vi.fn<() => Promise<PullRequestSessionStatus[]>>(async () => [current]),
  detail: vi.fn<(input: { pullRequest: PullRequestRef }) => Promise<PullRequestSnapshot>>(
    async ({ pullRequest }) => snapshot(pullRequest),
  ),
  current: vi.fn<() => Promise<void>>(),
  refresh: vi.fn<() => Promise<PullRequestSessionStatus>>(async () => current),
  exclude: vi.fn<(input: { pullRequest: PullRequestRef }) => Promise<void>>(
    async ({ pullRequest }) => {
      current = {
        ...current,
        links: current.links.map((item) =>
          item.ref.number === pullRequest.number ? { ...item, excluded: true } : item,
        ),
      };
    },
  ),
  stackPreview: vi.fn<() => Promise<PullRequestStackPreview>>(),
  runStackAction: vi.fn<
    () => Promise<{
      action: "rebase";
      outcome: "partial";
      completed: PullRequestRef[];
      message: string;
    }>
  >(async () => ({
    action: "rebase",
    outcome: "partial",
    completed: [ref(1)],
    message: "Second layer changed.",
  })),
  runAction: vi.fn<() => Promise<void>>(),
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  current = { ref: sessionRef, links: [link(1), link(2)], state: "ready" };
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } },
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  queryClient.clear();
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const panel = () =>
  pullRequestPanel.view.render({
    id: "pull-request",
    sessionRef: environmentSession,
    payload: undefined,
    activate() {},
    close() {},
    setPayload() {},
    reopen() {},
  });
async function render(children: ReactNode) {
  const client = {
    pullRequest: api,
    agent: {
      session: {
        list: async () => [],
        subscribe: async (_input: unknown, options?: { signal?: AbortSignal }) =>
          (async function* () {
            if (options?.signal?.aborted) return;
            await new Promise<void>((resolve) => {
              options?.signal?.addEventListener("abort", () => resolve(), { once: true });
            });
            yield* [];
          })(),
      },
    },
  };
  const orpc = mockEnvironmentOrpc(createTanstackQueryUtils(client));
  const environmentRpc: EnvironmentRpc = {
    localId: "local",
    queryClient,
    for: () => orpc,
    httpBaseUrl: () => "http://127.0.0.1",
    sync: () => undefined,
  };
  const context = { localEnvironmentId: "local", environmentRpc };
  const routeTree = createRootRouteWithContext<typeof context>()({
    component: () => (
      <PlatformProvider value={{}}>
        <EnvironmentOrpcProvider orpc={orpc}>
          <PullRequestDemandProvider>{children}</PullRequestDemandProvider>
        </EnvironmentOrpcProvider>
      </PlatformProvider>
    ),
  });
  const router = createRouter({ routeTree, context, history: createMemoryHistory() });
  await act(async () => {
    await router.load();
    root.render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
  });
}
async function settle(assertion: () => void) {
  await vi.waitFor(async () => {
    await act(async () => {});
    assertion();
  });
}
async function click(text: string) {
  const button = [...document.querySelectorAll("button")].find((item) =>
    item.textContent?.includes(text),
  );
  if (!button) throw new Error(`missing ${text}`);
  await act(async () => button.click());
}

it("reads the selected linked identity, retains unknown links, cancels associations, and retries", async () => {
  await render(panel());
  await settle(() => expect(container.textContent).toContain("Detail 1"));
  expect(api.current).not.toHaveBeenCalled();
  expect(container.textContent).toContain("Identity saved; status unknown");
  await click("pie/pie#2");
  await settle(() => expect(container.textContent).toContain("Detail 2"));
  expect(api.detail).toHaveBeenLastCalledWith(
    expect.objectContaining({ ref: sessionRef, pullRequest: ref(2) }),
    expect.anything(),
  );
  const cancel = container.querySelector<HTMLButtonElement>(
    '[aria-label="Cancel association with github.com/pie/pie#2"]',
  );
  if (!cancel) throw new Error("missing cancel");
  await act(async () => cancel.click());
  await settle(() => expect(container.textContent).not.toContain("pie/pie#2"));
  expect(api.exclude).toHaveBeenCalledWith({ ref: sessionRef, pullRequest: ref(2) });
  await click("Refresh");
  await settle(() => expect(api.refresh).toHaveBeenCalledOnce());
  expect(container.textContent).not.toContain("Add pull request");
});

it("releases hidden panels and never fetches details for hidden or unmounted panels", async () => {
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
  await render(panel());
  expect(api.detail).not.toHaveBeenCalled();
  expect(api.demand).not.toHaveBeenCalled();
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  await act(async () => document.dispatchEvent(new Event("visibilitychange")));
  await settle(() => expect(api.detail).toHaveBeenCalled());
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
  await act(async () => document.dispatchEvent(new Event("visibilitychange")));
  await settle(() =>
    expect(api.demand).toHaveBeenLastCalledWith(
      expect.objectContaining({ refs: [] }),
      expect.anything(),
    ),
  );
  const before = api.detail.mock.calls.length;
  await act(async () => {
    await queryClient.invalidateQueries();
  });
  expect(api.detail).toHaveBeenCalledTimes(before);
  await render(null);
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  await act(async () => document.dispatchEvent(new Event("visibilitychange")));
  expect(api.detail).toHaveBeenCalledTimes(before);
});

it("requires a native preview and confirmation, then reports partial completion without retrying", async () => {
  const stack = {
    id: "stack",
    number: 3,
    baseBranch: "main",
    layers: [1, 2].map((number) => ({
      ref: ref(number),
      headBranch: `layer-${number}`,
      lifecycle: { type: "open" as const, draft: false },
    })),
  };
  current = { ...current, links: current.links.map((item) => ({ ...item, stack })) };
  const preview: PullRequestStackPreview = {
    pullRequest: ref(2),
    action: "rebase",
    stack,
    expected: {
      stackId: "stack",
      baseBranch: "main",
      members: [1, 2].map((number) => ({
        pullRequest: ref(number),
        headBranch: `layer-${number}`,
        headSha: `head-${number}`,
      })),
    },
    affected: [ref(1), ref(2)],
    methods: [],
    allowed: true,
  };
  api.stackPreview.mockResolvedValue(preview);
  await render(panel());
  await settle(() => expect(container.textContent).toContain("Preview rebase Stack"));
  await click("Preview rebase Stack");
  await settle(() => expect(document.body.textContent).toContain("Rebase native Stack #3?"));
  expect(api.runStackAction).not.toHaveBeenCalled();
  await click("Confirm rebase");
  await settle(() => expect(container.textContent).toContain("Stack action partially completed."));
  expect(api.runStackAction).toHaveBeenCalledOnce();
  expect(api.runStackAction).toHaveBeenCalledWith({
    ref: sessionRef,
    pullRequest: ref(2),
    action: "rebase",
    expected: preview.expected,
  });
  expect(container.textContent).toContain("Confirmed completed: github.com/pie/pie#1");
  expect(document.body.textContent).not.toContain("Rebase native Stack #3?");
});

it("shows multiple unrelated PRs as an additional count and preserves neutral unknown identity", async () => {
  await render(<SessionPullRequestIndicator status={current} />);
  const indicator = container.querySelector("a");
  expect(indicator?.textContent).toContain("#1 +1");
  expect(indicator?.getAttribute("aria-label")).toContain("status unknown");
  expect(indicator?.href).toBe("https://github.com/pie/pie/pull/1");
  expect(indicator?.textContent).not.toContain("Stack");
});
