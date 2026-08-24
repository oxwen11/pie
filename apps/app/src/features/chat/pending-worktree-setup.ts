import type { SessionRef } from "@getpie/contract";

export type PendingWorktreeSetup = {
  readonly ref: SessionRef;
  readonly projectPath: string;
  readonly text: string;
  readonly worktreeBranch: string;
};

const pending = new Map<string, PendingWorktreeSetup>();

export const setPendingWorktreeSetup = (setup: PendingWorktreeSetup): void => {
  pending.set(setup.ref.sessionId, setup);
};

export const peekPendingWorktreeSetup = (sessionId: string): PendingWorktreeSetup | undefined =>
  pending.get(sessionId);

export const clearPendingWorktreeSetup = (sessionId: string): void => {
  pending.delete(sessionId);
};
