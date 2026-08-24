import type { SessionRef, SessionSummary } from "@getpie/contract";
// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  queryOptions: vi.fn<
    (options: { input: { projectId: string; archived: boolean } }) => {
      queryKey: ReadonlyArray<unknown>;
      queryFn: () => Promise<ReadonlyArray<SessionSummary>>;
    }
  >(),
}));

vi.mock("@tanstack/react-router", () => ({
  useRouteContext: () => ({
    orpcQueryUtils: { agent: { session: { list: { queryOptions: mocks.queryOptions } } } },
  }),
}));

import {
  selectProjectSessionPhase,
  selectProjectSessionTitle,
  useProjectSessionPhase,
  useProjectSessionTitle,
} from "./use-project-sessions";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const session = (
  sessionId: string,
  title: string | undefined,
  archived = false,
  status?: SessionSummary["status"],
): SessionSummary => ({
  projectId: "project-1",
  sessionId,
  ...(title === undefined ? {} : { title }),
  archived,
  createdAt: "2026-08-08T00:00:00.000Z",
  historyAvailable: true,
  ...(status === undefined ? {} : { status }),
});

let root: Root | undefined;
let host: HTMLDivElement | undefined;

const refFor = (sessionId: string, overrides: Partial<SessionRef> = {}): SessionRef => ({
  projectId: "project-1",
  sessionId,
  ...overrides,
});

function TitleProbe({ sessionId }: { sessionId: string }) {
  const title = useProjectSessionTitle(refFor(sessionId));
  return createElement("span", null, title ?? "missing");
}

function PhaseProbe({ sessionId }: { sessionId: string }) {
  const phase = useProjectSessionPhase(refFor(sessionId));
  return createElement("span", null, phase ?? "missing");
}

const renderSession = async (
  sessionId: string,
  active: ReadonlyArray<SessionSummary>,
  archived: ReadonlyArray<SessionSummary> = [],
  fetches: boolean[] = [],
  waitForTitle = true,
): Promise<string> => {
  mocks.queryOptions.mockImplementation(
    ({ input }: { input: { projectId: string; archived: boolean } }) => ({
      queryKey: ["session.list", input],
      queryFn: async () => {
        fetches.push(input.archived);
        return input.archived ? archived : active;
      },
    }),
  );
  if (!host) {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  }
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  act(() =>
    root?.render(
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(TitleProbe, { sessionId }),
      ),
    ),
  );
  await act(async () => {
    await vi.waitFor(() =>
      waitForTitle
        ? expect(host?.textContent).not.toBe("missing")
        : expect(fetches).toHaveLength(1),
    );
  });
  return host.textContent ?? "";
};

const renderSessionPhase = async (
  sessionId: string,
  active: ReadonlyArray<SessionSummary>,
  archived: ReadonlyArray<SessionSummary> = [],
  fetches: boolean[] = [],
  waitForPhase = true,
): Promise<string> => {
  mocks.queryOptions.mockImplementation(
    ({ input }: { input: { projectId: string; archived: boolean } }) => ({
      queryKey: ["session.list", input],
      queryFn: async () => {
        fetches.push(input.archived);
        return input.archived ? archived : active;
      },
    }),
  );
  if (!host) {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  }
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  act(() =>
    root?.render(
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(PhaseProbe, { sessionId }),
      ),
    ),
  );
  await act(async () => {
    await vi.waitFor(() =>
      waitForPhase
        ? expect(host?.textContent).not.toBe("missing")
        : expect(fetches).toHaveLength(1),
    );
  });
  return host.textContent ?? "";
};

afterEach(() => {
  const mounted = root;
  act(() => mounted?.unmount());
  host?.remove();
  root = undefined;
  host = undefined;
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

describe("selectProjectSessionPhase", () => {
  it("selects the runtime phase for the active session", () => {
    const sessions = [
      session("session-1", "First chat", false, { phase: "running" }),
      session("session-2", "Second chat", false, { phase: "requires_action" }),
      session("session-3", "Idle chat"),
    ];

    expect(selectProjectSessionPhase(sessions, refFor("session-1"))).toBe("running");
    expect(selectProjectSessionPhase(sessions, refFor("session-2"))).toBe("requires_action");
    expect(selectProjectSessionPhase(sessions, refFor("session-3"))).toBeNull();
    expect(selectProjectSessionPhase(sessions, refFor("missing"))).toBeUndefined();
  });
});

describe("useProjectSessionTitle", () => {
  it("reads an active title without fetching the archived list", async () => {
    const fetches: boolean[] = [];
    await expect(
      renderSession(
        "session-2",
        [session("session-1", "First chat"), session("session-2", "Second chat")],
        [],
        fetches,
      ),
    ).resolves.toBe("Second chat");
    expect(fetches).toEqual([false]);
  });

  it("does not query archived sessions when the active session exists without a title", async () => {
    const fetches: boolean[] = [];
    await expect(
      renderSession(
        "untitled",
        [session("untitled", undefined)],
        [session("untitled", "stale archived title", true)],
        fetches,
        false,
      ),
    ).resolves.toBe("missing");
    expect(fetches).toEqual([false]);
  });

  it("falls back to the archived list for a valid archived-session route", async () => {
    await expect(
      renderSession("session-3", [], [session("session-3", "Archived chat", true)]),
    ).resolves.toBe("Archived chat");
  });
});

describe("useProjectSessionPhase", () => {
  it("reads an active session phase without fetching the archived list", async () => {
    const fetches: boolean[] = [];
    await expect(
      renderSessionPhase(
        "session-2",
        [
          session("session-1", "First chat", false, { phase: "running" }),
          session("session-2", "Second chat", false, { phase: "crashed" }),
        ],
        [],
        fetches,
      ),
    ).resolves.toBe("crashed");
    expect(fetches).toEqual([false]);
  });

  it("does not query archived sessions when the active session exists without status", async () => {
    const fetches: boolean[] = [];
    await expect(
      renderSessionPhase(
        "untitled",
        [session("untitled", undefined)],
        [session("untitled", "stale archived title", true, { phase: "running" })],
        fetches,
        false,
      ),
    ).resolves.toBe("missing");
    expect(fetches).toEqual([false]);
  });

  it("falls back to the archived list for a valid archived-session route", async () => {
    await expect(
      renderSessionPhase(
        "session-3",
        [],
        [session("session-3", "Archived chat", true, { phase: "requires_action" })],
      ),
    ).resolves.toBe("requires_action");
  });
});
