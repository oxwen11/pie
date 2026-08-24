import type { SessionRef } from "@getpie/contract";

export type PendingSessionStart = {
  readonly ref: SessionRef;
  readonly text: string;
  readonly workspaceMode: "project" | "worktree";
};

const pending = new Map<string, PendingSessionStart>();
// StrictMode runs effects twice before the route re-renders; claim once per session.
const startPromptClaimed = new Set<string>();

export const setPendingSessionStart = (start: PendingSessionStart): void => {
  pending.set(start.ref.sessionId, start);
};

export const peekPendingSessionStart = (sessionId: string): PendingSessionStart | undefined =>
  pending.get(sessionId);

export const clearPendingSessionStart = (sessionId: string): void => {
  pending.delete(sessionId);
};

/** Returns true the first time a session's bootstrap prompt should fire. */
export const claimSessionStartPrompt = (sessionId: string): boolean => {
  if (startPromptClaimed.has(sessionId)) return false;
  startPromptClaimed.add(sessionId);
  return true;
};
