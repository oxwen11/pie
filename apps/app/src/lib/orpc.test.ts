import type { PieClient } from "@getpie/client";
import { createORPCClient } from "@orpc/client";
import { describe, expect, it } from "vitest";

import { createAppQueryClient, createEnvironmentOrpc } from "./orpc";

const createTestOrpc = () => {
  const queryClient = createAppQueryClient();
  const client = createORPCClient<PieClient>({
    call: async () => undefined,
  });
  return {
    queryClient,
    orpc: createEnvironmentOrpc(client, "env-a", queryClient),
  };
};

describe("createEnvironmentOrpc", () => {
  it("keeps cache policy on the query client instead of per-query options", () => {
    const { queryClient, orpc } = createTestOrpc();

    expect(orpc.project.list.key()[0]).toBe("env-a");
    expect(queryClient.getDefaultOptions().queries).toMatchObject({
      staleTime: Infinity,
      refetchOnWindowFocus: "always",
    });
    expect(queryClient.getQueryDefaults(orpc.agent.session.list.key()).staleTime).toBe(30_000);
    const pullRequestDefaults = {
      staleTime: 15_000,
      retry: false,
      meta: { errorMode: "inline" },
    };
    expect(queryClient.getQueryDefaults(orpc.pullRequest.current.key())).toMatchObject(
      pullRequestDefaults,
    );
    expect(queryClient.getQueryDefaults(orpc.pullRequest.diff.key())).toMatchObject(
      pullRequestDefaults,
    );
    expect(queryClient.getQueryDefaults(orpc.pullRequest.statuses.key())).toMatchObject(
      pullRequestDefaults,
    );
    expect(queryClient.getQueryDefaults(orpc.pullRequest.list.key())).toMatchObject(
      pullRequestDefaults,
    );
    expect(queryClient.getQueryDefaults(orpc.pullRequest.detail.key())).toMatchObject(
      pullRequestDefaults,
    );
  });

  it("marks queries with inline error UI so they never also toast", () => {
    const { queryClient, orpc } = createTestOrpc();

    for (const key of [
      orpc.git.review.key(),
      orpc.git.diff.key(),
      orpc.fs.readTree.key(),
      orpc.fs.readFileString.key(),
    ]) {
      expect(queryClient.getQueryDefaults(key).meta).toEqual({ errorMode: "inline" });
    }
    expect(queryClient.getQueryDefaults(orpc.git.branch.key())).toMatchObject({
      retry: false,
      meta: { errorMode: "inline" },
    });
    expect(queryClient.getQueryDefaults(orpc.project.list.key()).meta).toBeUndefined();
  });
});
