import type { GitReviewMode } from "@getpie/contract/git";
import { skipToken, useQuery } from "@tanstack/react-query";
import { useRouteContext } from "@tanstack/react-router";

export function useGitReview(
  cwd: string | undefined,
  mode: GitReviewMode,
  other: string | undefined,
) {
  const { orpcQueryUtils } = useRouteContext({ from: "__root__" });
  return useQuery({
    ...orpcQueryUtils.git.review.queryOptions({
      input:
        cwd === undefined
          ? skipToken
          : {
              cwd,
              mode,
              ...(mode === "branch" && other !== undefined ? { other } : {}),
            },
    }),
    enabled: cwd !== undefined && (mode !== "branch" || other !== undefined),
    refetchOnWindowFocus: "always",
    staleTime: Infinity,
  });
}

export type GitReviewQuery = ReturnType<typeof useGitReview>;
