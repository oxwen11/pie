import { describe, expect, it } from "vitest";

import {
  claimSessionStartPrompt,
  clearPendingSessionStart,
  peekPendingSessionStart,
  setPendingSessionStart,
} from "./pending-session-start";

const ref = { projectId: "project-1", sessionId: "session-1" };

describe("pending session start", () => {
  it("claims the bootstrap prompt only once per session", () => {
    expect(claimSessionStartPrompt("session-a")).toBe(true);
    expect(claimSessionStartPrompt("session-a")).toBe(false);
    expect(claimSessionStartPrompt("session-b")).toBe(true);
  });

  it("tracks pending start until cleared", () => {
    setPendingSessionStart({ ref, text: "hello", workspaceMode: "project" });
    expect(peekPendingSessionStart(ref.sessionId)?.text).toBe("hello");
    clearPendingSessionStart(ref.sessionId);
    expect(peekPendingSessionStart(ref.sessionId)).toBeUndefined();
  });
});
