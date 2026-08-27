import type { GitBranch } from "@getpie/contract/git";

export function defaultWorktreeBase(branch: GitBranch | undefined): string | null {
  if (branch?.kind !== "repository") return null;
  return branch.defaultBranch ?? branch.current;
}
