import { describe, expect, it } from "vitest";

import type { ServerConnection } from "@/server-connection";

import { createAppClients } from "./orpc";

describe("createAppClients", () => {
  it("creates clients for a resolved external server", () => {
    const server: ServerConnection = {
      httpBaseUrl: "http://127.0.0.1:43123",
      wsBaseUrl: "ws://127.0.0.1:43123",
      token: "desktop-token",
    };

    const clients = createAppClients(server);

    expect(clients.orpcClient).toBeDefined();
    expect(clients.orpcClient.agent.session).toBeDefined();
    expect(clients.orpcQueryUtils).toBeDefined();
    clients.queryClient.clear();
  });

  it("keeps cache policy on the query client instead of per-query options", () => {
    const { queryClient, orpcQueryUtils } = createAppClients();

    expect(queryClient.getDefaultOptions().queries).toMatchObject({
      staleTime: Infinity,
      refetchOnWindowFocus: "always",
    });
    expect(queryClient.getQueryDefaults(orpcQueryUtils.agent.session.list.key()).staleTime).toBe(
      30_000,
    );
    const pullRequestDefaults = {
      staleTime: 15_000,
      retry: false,
      meta: { errorMode: "inline" },
    };
    expect(queryClient.getQueryDefaults(orpcQueryUtils.pullRequest.current.key())).toMatchObject(
      pullRequestDefaults,
    );
    expect(queryClient.getQueryDefaults(orpcQueryUtils.pullRequest.statuses.key())).toMatchObject(
      pullRequestDefaults,
    );

    queryClient.clear();
  });

  it("marks queries with inline error UI so they never also toast", () => {
    const { queryClient, orpcQueryUtils } = createAppClients();

    for (const key of [
      orpcQueryUtils.git.review.key(),
      orpcQueryUtils.git.diff.key(),
      orpcQueryUtils.fs.readTree.key(),
      orpcQueryUtils.fs.readFileString.key(),
    ]) {
      expect(queryClient.getQueryDefaults(key).meta).toEqual({ errorMode: "inline" });
    }
    expect(queryClient.getQueryDefaults(orpcQueryUtils.git.branch.key()).meta).toBeUndefined();
    expect(queryClient.getQueryDefaults(orpcQueryUtils.project.list.key()).meta).toBeUndefined();

    queryClient.clear();
  });
});
