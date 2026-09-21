import type { PieClientContext } from "@getpie/client";
import type { ClientLink } from "@orpc/client";
import { describe, expect, it, vi } from "vitest";

import { createEnvironmentRpc } from "@/lib/environment-rpc";
import { createAppQueryClient } from "@/lib/orpc";

import { createEnvironmentCatalog } from "./environment-catalog";

type Call = {
  readonly environmentId?: string;
  readonly path: string;
};

type Subscription = {
  readonly environmentId?: string;
  readonly signal?: AbortSignal;
};

function catalogLink(calls: Call[], subscriptions: Subscription[]): ClientLink<PieClientContext> {
  return {
    call: async (path, _input, options) => {
      const joined = path.join(".");
      calls.push({ environmentId: options.context?.environmentId, path: joined });
      if (joined === "project.list") {
        return [{ id: "project-1", name: "Pie", path: "/tmp/pie" }];
      }
      if (joined === "agent.session.list") return [];
      if (joined === "agent.session.subscribe") {
        subscriptions.push({
          environmentId: options.context?.environmentId,
          signal: options.signal,
        });
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

describe("createEnvironmentCatalog", () => {
  it("warms projects and sessions for every started Environment", async () => {
    const calls: Call[] = [];
    const subscriptions: Subscription[] = [];
    const queryClient = createAppQueryClient();
    const remote = {
      httpBaseUrl: "http://127.0.0.1:5001",
      wsBaseUrl: "ws://127.0.0.1:5001",
      token: "tok",
    };
    const rpc = createEnvironmentRpc({
      localId: "env-local",
      localLink: catalogLink(calls, subscriptions),
      queryClient,
      resolveRemote: (id) => (id === "env-remote" ? remote : undefined),
      createRemoteLink: () => catalogLink(calls, subscriptions),
    });
    const catalog = createEnvironmentCatalog(rpc);

    catalog.start("env-local");
    rpc.sync(new Map([["env-remote", remote]]));
    catalog.start("env-remote");

    await vi.waitFor(() => {
      expect(calls).toEqual(
        expect.arrayContaining([
          { environmentId: "env-local", path: "project.list" },
          { environmentId: "env-local", path: "agent.session.list" },
          { environmentId: "env-remote", path: "project.list" },
          { environmentId: "env-remote", path: "agent.session.list" },
        ]),
      );
    });

    catalog.stop("env-remote");
    expect(
      subscriptions.find(({ environmentId }) => environmentId === "env-remote")?.signal?.aborted,
    ).toBe(true);
    expect(
      subscriptions.find(({ environmentId }) => environmentId === "env-local")?.signal?.aborted,
    ).toBe(false);

    catalog.dispose();
    expect(
      subscriptions.find(({ environmentId }) => environmentId === "env-local")?.signal?.aborted,
    ).toBe(true);
  });
});
