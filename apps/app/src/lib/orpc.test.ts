import { describe, expect, it } from "vitest";

import type { ServerConnection } from "@/server-connection";

import { createAppClients } from "./orpc";

describe("createAppClients", () => {
  it("creates clients for a resolved external server", () => {
    const server: ServerConnection = {
      connectWebSocket: async () => ({}) as WebSocket,
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

    queryClient.clear();
  });

  it("marks queries with inline error UI so they never also toast", () => {
    const { queryClient, orpcQueryUtils } = createAppClients();

    for (const key of [
      orpcQueryUtils.git.review.key(),
      orpcQueryUtils.git.diff.key(),
      orpcQueryUtils.fs.readTree.key(),
    ]) {
      expect(queryClient.getQueryDefaults(key).meta).toEqual({ errorMode: "inline" });
    }
    expect(queryClient.getQueryDefaults(orpcQueryUtils.git.branch.key()).meta).toBeUndefined();
    expect(queryClient.getQueryDefaults(orpcQueryUtils.project.list.key()).meta).toBeUndefined();

    queryClient.clear();
  });
});
