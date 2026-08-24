import type { SessionRef } from "@getpie/contract";

export type PendingSessionStart = {
  readonly ref: SessionRef;
  readonly text: string;
  readonly workspaceMode: "project" | "worktree";
};

const pending = new Map<string, PendingSessionStart>();

export const setPendingSessionStart = (start: PendingSessionStart): void => {
  pending.set(start.ref.sessionId, start);
};

export const peekPendingSessionStart = (sessionId: string): PendingSessionStart | undefined =>
  pending.get(sessionId);

export const clearPendingSessionStart = (sessionId: string): void => {
  pending.delete(sessionId);
};
