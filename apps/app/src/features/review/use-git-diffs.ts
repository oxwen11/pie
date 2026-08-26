import type { WorkspaceQuery } from "@getpie/contract";
import type { GitReviewFile, GitReviewMode } from "@getpie/contract/git";
import { skipToken, useQueries } from "@tanstack/react-query";
import { useRouteContext } from "@tanstack/react-router";

export function useGitDiffs(
  workspace: WorkspaceQuery | undefined,
  files: ReadonlyArray<GitReviewFile>,
  mode: GitReviewMode,
  other: string | undefined,
) {
  const { orpcQueryUtils } = useRouteContext({ from: "__root__" });
  return useQueries({
    queries: files.map((file) => ({
      ...orpcQueryUtils.git.diff.queryOptions({
        input:
          workspace === undefined
            ? skipToken
            : {
                ...workspace,
                path: file.path,
                mode,
                ...(mode === "branch" && other !== undefined ? { other } : {}),
              },
      }),
      refetchOnWindowFocus: "always" as const,
      staleTime: Infinity,
    })),
  });
}

export type GitDiffsQuery = ReturnType<typeof useGitDiffs>;
