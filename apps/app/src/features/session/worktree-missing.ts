import { decodeWorktreeMissingErrorData, type WorktreeMissingErrorData } from "@getpie/contract";
import { ORPCError } from "@orpc/client";

export function parseWorktreeMissingError(error: unknown): WorktreeMissingErrorData | undefined {
  if (!(error instanceof ORPCError) || error.code !== "WORKTREE_MISSING") return undefined;
  return decodeWorktreeMissingErrorData(error.data);
}
