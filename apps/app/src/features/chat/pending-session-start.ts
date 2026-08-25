import type { SessionRef } from "@getpie/contract";

export type PendingSessionStart = {
  readonly ref: SessionRef;
  readonly text: string;
  readonly workspaceMode: "project" | "worktree";
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object";

const isSessionRef = (value: unknown): value is SessionRef => {
  if (!isRecord(value)) return false;
  return typeof value.projectId === "string" && typeof value.sessionId === "string";
};

export const pendingSessionStartFromState = (
  state: unknown,
  ref: SessionRef,
): PendingSessionStart | undefined => {
  if (!isRecord(state)) return undefined;
  const raw = state.pendingSessionStart;
  if (!isRecord(raw) || !isSessionRef(raw.ref)) return undefined;
  if (raw.ref.projectId !== ref.projectId || raw.ref.sessionId !== ref.sessionId) {
    return undefined;
  }
  if (typeof raw.text !== "string" || raw.text.length === 0) return undefined;
  if (raw.workspaceMode !== "project" && raw.workspaceMode !== "worktree") return undefined;
  return {
    ref: raw.ref,
    text: raw.text,
    workspaceMode: raw.workspaceMode,
  };
};
