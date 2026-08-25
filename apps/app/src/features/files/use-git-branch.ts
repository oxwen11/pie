import type { WorkspaceQuery } from "@getpie/contract";
import { skipToken, useQuery } from "@tanstack/react-query";
import { useRouteContext } from "@tanstack/react-router";

export function useGitBranch(workspace: WorkspaceQuery | undefined) {
  const { orpcQueryUtils } = useRouteContext({ from: "__root__" });
  return useQuery({
    ...orpcQueryUtils.git.branch.queryOptions({
      input: workspace === undefined ? skipToken : workspace,
    }),
    refetchOnWindowFocus: "always",
    staleTime: Infinity,
  });
}

export type GitBranchQuery = ReturnType<typeof useGitBranch>;
