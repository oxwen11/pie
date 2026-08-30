// @vitest-environment jsdom
import type { Project } from "@getpie/contract";
import { QueryClient } from "@tanstack/react-query";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ useRouteContext: vi.fn<() => object>() }));

vi.mock("@tanstack/react-router", () => ({
  useRouteContext: mocks.useRouteContext,
}));

import { useSessionListSync } from "./use-session-list-sync";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const project = (id: string): Project => ({
  id,
  name: id,
  path: `/tmp/${id}`,
  createdAt: "2026-08-30T00:00:00.000Z",
});

const waitForAbort = (signal: AbortSignal): AsyncIterable<never> => ({
  [Symbol.asyncIterator]: () => ({
    next: () =>
      new Promise<IteratorResult<never>>((resolve) => {
        const finish = () => resolve({ done: true, value: undefined });
        if (signal.aborted) finish();
        else signal.addEventListener("abort", finish, { once: true });
      }),
  }),
});

let root: Root | undefined;
let host: HTMLDivElement | undefined;

function Probe({ onProjectDeleted }: { readonly onProjectDeleted: (projectId: string) => void }) {
  useSessionListSync(onProjectDeleted);
  return null;
}

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = undefined;
  host = undefined;
  mocks.useRouteContext.mockReset();
  vi.useRealTimers();
});

describe("useSessionListSync", () => {
  it("reconciles removed Projects after the subscription reconnects", async () => {
    vi.useFakeTimers();
    const previous = [project("removed"), project("kept")];
    const current = [project("kept")];
    const projectListKey = ["project", "list", { type: "query" }] as const;
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(projectListKey, previous);
    const subscribe = vi
      .fn<
        (input: unknown, options: { readonly signal: AbortSignal }) => Promise<AsyncIterable<never>>
      >()
      .mockRejectedValueOnce(new Error("server unavailable"))
      .mockImplementationOnce((_input, options: { readonly signal: AbortSignal }) =>
        Promise.resolve(waitForAbort(options.signal)),
      );
    mocks.useRouteContext.mockReturnValue({
      orpcClient: { agent: { session: { subscribe } } },
      orpcQueryUtils: {
        agent: {
          listModels: {
            queryOptions: ({ input }: { input: { projectId: string } }) => ({
              queryKey: [["agent", "listModels"], { input, type: "query" }],
            }),
          },
          session: {
            getModelState: {
              key: () => [["agent", "session", "getModelState"], {}],
            },
            list: {
              key: () => ["agent", "session", "list"],
              queryOptions: ({ input }: { input: { projectId: string; archived: boolean } }) => ({
                queryKey: ["agent", "session", "list", input, { type: "query" }],
              }),
            },
          },
        },
        project: {
          list: {
            key: () => ["project", "list"],
            queryOptions: () => ({ queryKey: projectListKey, queryFn: async () => current }),
          },
        },
      },
      queryClient,
    });
    const onProjectDeleted = vi.fn<(projectId: string) => void>();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);

    act(() => root?.render(createElement(Probe, { onProjectDeleted })));
    await act(async () => {
      await vi.waitFor(() => expect(subscribe).toHaveBeenCalledTimes(1));
      await vi.advanceTimersByTimeAsync(1000);
      await vi.waitFor(() => expect(subscribe).toHaveBeenCalledTimes(2));
      await vi.waitFor(() => expect(onProjectDeleted).toHaveBeenCalledWith("removed"));
    });
  });
});
