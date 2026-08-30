import type { Project } from "@getpie/contract";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

import {
  notifyRemovedProjects,
  removeProjectFromCache,
  removeProjectFromList,
} from "./project-list-cache";

const project = (id: string): Project => ({
  id,
  name: id,
  path: `/tmp/${id}`,
  createdAt: "2026-08-25T00:00:00.000Z",
});

describe("project list cache", () => {
  it("removes one Project from the authoritative list cache", () => {
    const queryClient = new QueryClient();
    const listKey = ["project", "list"];
    queryClient.setQueryData(listKey, [project("a"), project("b")]);

    removeProjectFromList(queryClient, listKey, "a");

    expect(queryClient.getQueryData(listKey)).toEqual([project("b")]);
  });

  it("reports Projects that disappeared across a recovered snapshot", () => {
    const onRemoved = vi.fn<(projectId: string) => void>();

    notifyRemovedProjects(
      [project("removed"), project("kept")],
      [project("kept"), project("added")],
      onRemoved,
    );

    expect(onRemoved).toHaveBeenCalledOnce();
    expect(onRemoved).toHaveBeenCalledWith("removed");
  });

  it("purges every query owned by the removed Project and keeps other Projects", () => {
    const queryClient = new QueryClient();
    const keys = {
      projectList: [["project", "list"], { type: "query" }] as const,
      sessionList: (projectId: string, archived: boolean) =>
        [["agent", "session", "list"], { input: { projectId, archived }, type: "query" }] as const,
      listModels: (projectId: string) =>
        [["agent", "listModels"], { input: { projectId }, type: "query" }] as const,
      modelStatePrefix: [["agent", "session", "getModelState"], {}] as const,
    };
    const removedRef = { projectId: "removed", sessionId: "session-a" };
    const keptRef = { projectId: "kept", sessionId: "session-b" };
    const modelStateKey = (ref: typeof removedRef) =>
      [["agent", "session", "getModelState"], { input: { ref }, type: "query" }] as const;
    queryClient.setQueryData(keys.projectList, [project("removed"), project("kept")]);
    queryClient.setQueryData(keys.sessionList("removed", false), [{ sessionId: "session-a" }]);
    queryClient.setQueryData(keys.sessionList("removed", true), [{ sessionId: "session-c" }]);
    queryClient.setQueryData(keys.listModels("removed"), ["model-a"]);
    queryClient.setQueryData(modelStateKey(removedRef), { modelId: "model-a" });
    queryClient.setQueryData(modelStateKey(keptRef), { modelId: "model-b" });

    removeProjectFromCache(queryClient, keys, "removed");

    expect(queryClient.getQueryData(keys.projectList)).toEqual([project("kept")]);
    expect(queryClient.getQueryData(keys.sessionList("removed", false))).toBeUndefined();
    expect(queryClient.getQueryData(keys.sessionList("removed", true))).toBeUndefined();
    expect(queryClient.getQueryData(keys.listModels("removed"))).toBeUndefined();
    expect(queryClient.getQueryData(modelStateKey(removedRef))).toBeUndefined();
    expect(queryClient.getQueryData(modelStateKey(keptRef))).toEqual({ modelId: "model-b" });
  });
});
