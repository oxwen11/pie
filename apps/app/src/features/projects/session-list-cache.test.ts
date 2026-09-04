import type { ListSessionsOutput, SessionRef, ServerEvent } from "@getpie/contract";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import { applySessionListEvent, type ListKeyFor } from "./session-list-cache";

const ref: SessionRef = {
  projectId: "project-1",
  sessionId: "session-1",
};

const listKeyFor: ListKeyFor = (projectId, archived) => ["sessions", projectId, archived];

const seed = () => {
  const queryClient = new QueryClient();
  const rows: ListSessionsOutput = [
    {
      ...ref,
      archived: false,
      createdAt: "2026-08-03T00:00:00.000Z",
      historyAvailable: true,
      title: "hello",
    },
  ];
  queryClient.setQueryData(listKeyFor(ref.projectId, false), rows);
  queryClient.setQueryData(listKeyFor(ref.projectId, true), []);
  return queryClient;
};

describe("applySessionListEvent", () => {
  it("ignores transcript chunks", () => {
    const queryClient = seed();
    applySessionListEvent(queryClient, listKeyFor, {
      ref,
      seq: 1,
      type: "session.message.chunk",
      turnId: "turn-1",
      chunk: { type: "text-delta", id: "t", delta: "x" },
      phase: "running",
    });
    expect(queryClient.getQueryState(listKeyFor(ref.projectId, false))?.isInvalidated).toBe(false);
    expect(queryClient.getQueryState(listKeyFor(ref.projectId, true))?.isInvalidated).toBe(false);
  });

  it.each<ServerEvent>([
    { ref, seq: 1, type: "session.turn.started", turnId: "turn-1", phase: "running" },
    { ref, type: "session.created" },
    { ref, type: "session.updated", title: "updated" },
    { ref, type: "session.renamed", title: "renamed" },
    { ref, type: "session.archived", archived: true },
    { ref, type: "session.deleted" },
    { ref, type: "session.closed" },
  ])("invalidates both authoritative lists for $type", (event) => {
    const queryClient = seed();
    applySessionListEvent(queryClient, listKeyFor, event);
    expect(queryClient.getQueryState(listKeyFor(ref.projectId, false))?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(listKeyFor(ref.projectId, true))?.isInvalidated).toBe(true);
  });
});
