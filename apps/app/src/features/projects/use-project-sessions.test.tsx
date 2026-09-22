import type { SessionRef, SessionSummary } from "@getpie/contract";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";

const mocks = vi.hoisted(() => ({
  queryOptions: vi.fn<
    (options: { input: { projectId: string; archived: boolean } }) => {
      queryKey: ReadonlyArray<unknown>;
      queryFn: () => Promise<ReadonlyArray<SessionSummary>>;
    }
  >(),
}));

// oxlint-disable-next-line anti-slop/no-module-mocking -- route context comes from the route tree, not a test seam
vi.mock("@tanstack/react-router", () => ({
  useRouteContext: () => ({
    localEnvironmentId: "local",
    environmentRpc: {
      for: () => ({ agent: { session: { list: { queryOptions: mocks.queryOptions } } } }),
    },
  }),
}));

import { selectProjectSessionTitle, useProjectSessionTitle } from "./use-project-sessions";

const session = (
  sessionId: string,
  title: string | undefined,
  archived = false,
): SessionSummary => ({
  projectId: "project-1",
  sessionId,
  ...(title === undefined ? undefined : { title }),
  archived,
  createdAt: "2026-08-08T00:00:00.000Z",
  historyAvailable: true,
});

const refFor = (sessionId: string, overrides: Partial<SessionRef> = {}): SessionRef => ({
  projectId: "project-1",
  sessionId,
  ...overrides,
});

function Probe({ sessionId }: { sessionId: string }) {
  const title = useProjectSessionTitle(refFor(sessionId));
  return <span>{title ?? "missing"}</span>;
}

const renderSession = async (
  sessionId: string,
  active: ReadonlyArray<SessionSummary>,
  archived: ReadonlyArray<SessionSummary> = [],
  fetches: boolean[] = [],
  waitForTitle = true,
): Promise<void> => {
  mocks.queryOptions.mockImplementation(
    ({ input }: { input: { projectId: string; archived: boolean } }) => ({
      queryKey: ["session.list", input],
      queryFn: async () => {
        fetches.push(input.archived);
        return input.archived ? archived : active;
      },
    }),
  );
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await render(
    <QueryClientProvider client={queryClient}>
      <Probe sessionId={sessionId} />
    </QueryClientProvider>,
  );
  if (waitForTitle) {
    await expect.element(page.getByText("missing")).not.toBeInTheDocument();
  } else {
    await expect.poll(() => fetches.length).toBe(1);
  }
};

afterEach(() => {
  mocks.queryOptions.mockReset();
});

describe("selectProjectSessionTitle", () => {
  it("selects the title for the active session instead of reusing another session's header", () => {
    const sessions = [session("session-1", "First chat"), session("session-2", "Second chat")];

    expect(selectProjectSessionTitle(sessions, refFor("session-1"))).toBe("First chat");
    expect(selectProjectSessionTitle(sessions, refFor("session-2"))).toBe("Second chat");
    expect(
      selectProjectSessionTitle(sessions, refFor("session-1", { projectId: "other-project" })),
    ).toBeUndefined();
    expect(
      selectProjectSessionTitle([session("untitled", undefined)], refFor("untitled")),
    ).toBeNull();
  });
});

describe("useProjectSessionTitle", () => {
  it("reads an active title without fetching the archived list", async () => {
    const fetches: boolean[] = [];
    await renderSession(
      "session-2",
      [session("session-1", "First chat"), session("session-2", "Second chat")],
      [],
      fetches,
    );
    await expect.element(page.getByText("Second chat")).toBeVisible();
    expect(fetches).toEqual([false]);
  });

  it("does not query archived sessions when the active session exists without a title", async () => {
    const fetches: boolean[] = [];
    await renderSession(
      "untitled",
      [session("untitled", undefined)],
      [session("untitled", "stale archived title", true)],
      fetches,
      false,
    );
    await expect.element(page.getByText("missing")).toBeVisible();
    expect(fetches).toEqual([false]);
  });

  it("falls back to the archived list for a valid archived-session route", async () => {
    await renderSession("session-3", [], [session("session-3", "Archived chat", true)]);
    await expect.element(page.getByText("Archived chat")).toBeVisible();
  });
});
