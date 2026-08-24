import type { SessionRef } from "@getpie/contract";
import type { GitWorkspaceInput } from "@getpie/contract/git";

export type GitWorkspaceQuery = GitWorkspaceInput;

export const gitWorkspaceForCwd = (cwd: string): GitWorkspaceQuery => ({ cwd });

export const gitWorkspaceForRef = (ref: SessionRef): GitWorkspaceQuery => ({ ref });
