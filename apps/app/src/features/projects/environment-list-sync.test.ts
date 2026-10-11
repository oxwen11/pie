import type { PieClientContext } from "@getpie/client";
import type { ClientLink } from "@orpc/client";
import { describe, expect, it, vi } from "vitest";

import { createEnvironmentRpc } from "@/lib/environment-rpc";
import { createAppQueryClient } from "@/lib/orpc";

import { createEnvironmentListSync } from "./environment-list-sync";

type Call = {
  readonly environmentId?: string;
  readonly path: string;
};

type Subscription = {
  readonly environmentId?: string;
  readonly signal?: AbortSignal;
};

function fakeLink(calls: Call[], subscriptions: Subscription[]): ClientLink<PieClientContext> {
  return {
    call: async (path, _input, options) => {
      const joined = path.join(".");
      calls.push({ environmentId: options.context?.environmentId, path: joined });
      if (joined === "project.ls") {
        return [{ id: "project-1", name: "Pie", path: "/tmp/pie" }];
      }
      if (joined === "session.ls") return [];
      if (joined === "session.subscribe") {
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

describe("createEnvironmentListSync", () => {
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
      localLink: fakeLink(calls, subscriptions),
      queryClient,
      resolveRemote: (id) => (id === "env-remote" ? remote : undefined),
      createRemoteLink: () => fakeLink(calls, subscriptions),
    });
    const listSync = createEnvironmentListSync(rpc);

    listSync.start("env-local");
    rpc.sync(new Map([["env-remote", remote]]));
    listSync.start("env-remote");

    await vi.waitFor(() => {
      expect(calls).toEqual(
        expect.arrayContaining([
          { environmentId: "env-local", path: "project.ls" },
          { environmentId: "env-local", path: "session.ls" },
          { environmentId: "env-remote", path: "project.ls" },
          { environmentId: "env-remote", path: "session.ls" },
        ]),
      );
    });

    listSync.stop("env-remote");
    expect(
      subscriptions.find(({ environmentId }) => environmentId === "env-remote")?.signal?.aborted,
    ).toBe(true);
    expect(
      subscriptions.find(({ environmentId }) => environmentId === "env-local")?.signal?.aborted,
    ).toBe(false);

    listSync.dispose();
    expect(
      subscriptions.find(({ environmentId }) => environmentId === "env-local")?.signal?.aborted,
    ).toBe(true);
  });
});
