import { skipToken, useQuery } from "@tanstack/react-query";
import { useRouteContext } from "@tanstack/react-router";

export function useGitDiff(cwd: string | undefined, path: string | undefined) {
  const { orpcQueryUtils } = useRouteContext({ from: "__root__" });
  return useQuery({
    ...orpcQueryUtils.git.diff.queryOptions({
      input: cwd === undefined || path === undefined ? skipToken : { cwd, path },
    }),
    refetchOnWindowFocus: "always",
    staleTime: Infinity,
  });
}

export type GitDiffQuery = ReturnType<typeof useGitDiff>;
