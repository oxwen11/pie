import type { PieClientContext } from "@getpie/client";
import type { ClientLink } from "@orpc/client";
import { describe, expect, it } from "vitest";

import type { ServerConnection } from "@/server-connection";

import { createEnvironmentRpc } from "./environment-rpc";
import { createAppQueryClient } from "./orpc";

const connection = (port: number, token = "tok"): ServerConnection => ({
  httpBaseUrl: `http://127.0.0.1:${port}`,
  wsBaseUrl: `ws://127.0.0.1:${port}`,
  token,
});

type Call = {
  readonly environmentId?: string;
  readonly path: ReadonlyArray<string>;
};

function recordingLink(calls: Call[]): ClientLink<PieClientContext> {
  return {
    call: async (path, _input, options) => {
      calls.push({ environmentId: options.context?.environmentId, path });
      return [];
    },
  };
}

describe("createEnvironmentRpc", () => {
  it("routes one client through environment-prefixed oRPC utilities", async () => {
    const calls: Call[] = [];
    const queryClient = createAppQueryClient();
    const remote = connection(5001);
    const rpc = createEnvironmentRpc({
      localId: "env-local",
      localHttpBaseUrl: "http://127.0.0.1:4000",
      localLink: recordingLink(calls),
      queryClient,
      resolveRemote: (id) => (id === "env-remote" ? remote : undefined),
      createRemoteLink: () => recordingLink(calls),
    });

    const local = rpc.for("env-local");
    const firstRemote = rpc.for("env-remote");
    expect(rpc.httpBaseUrl("env-local")).toBe("http://127.0.0.1:4000");
    expect(rpc.httpBaseUrl("env-remote")).toBe(remote.httpBaseUrl);
    expect(rpc.for("env-remote")).toBe(firstRemote);
    expect(local.project.list.key()[0]).toBe("env-local");
    expect(firstRemote.project.list.key()[0]).toBe("env-remote");

    await Promise.all([
      queryClient.fetchQuery(local.project.list.queryOptions()),
      queryClient.fetchQuery(firstRemote.project.list.queryOptions()),
    ]);
    await firstRemote.project.list.call(undefined, {
      context: { environmentId: "env-local" },
    });

    expect(calls).toEqual([
      { environmentId: "env-local", path: ["project", "list"] },
      { environmentId: "env-remote", path: ["project", "list"] },
      { environmentId: "env-remote", path: ["project", "list"] },
    ]);
  });

  it("rotates links without rebuilding the scoped oRPC utilities", async () => {
    const calls: Call[] = [];
    const queryClient = createAppQueryClient();
    let remote = connection(5001, "a");
    let linkCount = 0;
    let disposeCount = 0;
    const rpc = createEnvironmentRpc({
      localId: "env-local",
      localLink: recordingLink(calls),
      queryClient,
      resolveRemote: (id) => (id === "env-remote" ? remote : undefined),
      createRemoteLink: () => {
        linkCount += 1;
        return Object.assign(recordingLink(calls), {
          dispose: () => {
            disposeCount += 1;
          },
        });
      },
    });

    const orpc = rpc.for("env-remote");
    expect(linkCount).toBe(1);
    remote = connection(5001, "b");
    await orpc.project.list.call(undefined);
    remote = { ...remote, wsBaseUrl: "ws://127.0.0.1:6001" };
    await orpc.project.list.call(undefined);

    expect(linkCount).toBe(3);
    expect(disposeCount).toBe(2);
    expect(rpc.for("env-remote")).toBe(orpc);
    expect(calls.at(-1)?.environmentId).toBe("env-remote");
  });

  it("removes only departed Environment state and keeps stale clients disconnected", async () => {
    const queryClient = createAppQueryClient();
    const remote = connection(5001);
    const rpc = createEnvironmentRpc({
      localId: "env-local",
      localLink: recordingLink([]),
      queryClient,
      resolveRemote: (id) => (id === "env-remote" ? remote : undefined),
      createRemoteLink: () => recordingLink([]),
    });
    const local = rpc.for("env-local");
    const remoteOrpc = rpc.for("env-remote");
    const localKey = local.project.list.key();
    const remoteKey = remoteOrpc.project.list.key();
    const localMutationKey = local.agent.session.archive.key();
    const remoteMutationKey = remoteOrpc.agent.session.archive.key();
    queryClient.setQueryData(localKey, ["local"]);
    queryClient.setQueryData(remoteKey, ["remote"]);
    queryClient.getMutationCache().build(queryClient, {
      mutationKey: localMutationKey,
      mutationFn: async () => undefined,
    });
    queryClient.getMutationCache().build(queryClient, {
      mutationKey: remoteMutationKey,
      mutationFn: async () => undefined,
    });

    const removed: string[] = [];
    rpc.sync(new Map(), (environmentId) => removed.push(environmentId));

    expect(removed).toEqual(["env-remote"]);
    expect(queryClient.getQueryData(localKey)).toEqual(["local"]);
    expect(queryClient.getQueryData(remoteKey)).toBeUndefined();
    expect(queryClient.getMutationCache().findAll({ mutationKey: localMutationKey })).toHaveLength(
      1,
    );
    expect(queryClient.getMutationCache().findAll({ mutationKey: remoteMutationKey })).toHaveLength(
      0,
    );
    await expect(remoteOrpc.project.list.call(undefined)).rejects.toThrow(/not connected/);
    expect(() => rpc.for("env-remote")).toThrow(/not connected/);

    rpc.sync(new Map([["env-remote", remote]]));
    expect(rpc.for("env-remote")).not.toBe(remoteOrpc);
  });
});
