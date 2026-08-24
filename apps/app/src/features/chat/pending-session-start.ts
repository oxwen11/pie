export type PendingSessionStartWorkspaceMode = "project" | "worktree";

export type PendingSessionStart = {
  readonly projectId: string;
  readonly projectPath: string;
  readonly sessionId: string;
  readonly text: string;
  readonly workspaceMode: PendingSessionStartWorkspaceMode;
  readonly worktreeBranch: string;
  readonly provider?: string;
  readonly modelId?: string;
};

const pending = new Map<string, PendingSessionStart>();

export const setPendingSessionStart = (start: PendingSessionStart): void => {
  pending.set(start.sessionId, start);
};

export const peekPendingSessionStart = (sessionId: string): PendingSessionStart | undefined =>
  pending.get(sessionId);

export const clearPendingSessionStart = (sessionId: string): void => {
  pending.delete(sessionId);
};
