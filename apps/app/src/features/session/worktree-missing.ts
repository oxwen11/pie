import type { WorktreeMissingErrorData } from "@getpie/contract";
import { ORPCError } from "@orpc/client";

const asText = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

export function parseWorktreeMissingError(error: unknown): WorktreeMissingErrorData | undefined {
  if (!(error instanceof ORPCError) || error.code !== "WORKTREE_MISSING") return undefined;
  const data: unknown = error.data;
  if (typeof data !== "object" || data === null) return undefined;
  const sessionId = asText("sessionId" in data ? data.sessionId : undefined);
  const projectId = asText("projectId" in data ? data.projectId : undefined);
  if (sessionId === undefined || projectId === undefined) return undefined;
  const branch = asText("branch" in data ? data.branch : undefined);
  return branch === undefined ? { sessionId, projectId } : { sessionId, projectId, branch };
}
