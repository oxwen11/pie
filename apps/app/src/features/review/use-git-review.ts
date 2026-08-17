import { skipToken, useQuery } from "@tanstack/react-query";
import { useRouteContext } from "@tanstack/react-router";

export function useGitReview(cwd: string | undefined) {
  const { orpcQueryUtils } = useRouteContext({ from: "__root__" });
  return useQuery({
    ...orpcQueryUtils.git.review.queryOptions({
      input: cwd === undefined ? skipToken : { cwd },
    }),
    refetchOnWindowFocus: "always",
    staleTime: Infinity,
  });
}

export type GitReviewQuery = ReturnType<typeof useGitReview>;
