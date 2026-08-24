import type { GitReviewMode } from "@getpie/contract/git";
import type { FileDiffContentsLoader } from "@pierre/diffs";
import { useRouteContext } from "@tanstack/react-router";
import { useCallback } from "react";

import { toLoadedDiffFiles } from "./review-patch";

export function useGitDiffLoader(
  cwd: string | undefined,
  mode: GitReviewMode,
  other: string | undefined,
): FileDiffContentsLoader {
  const { orpcClient } = useRouteContext({ from: "__root__" });
  return useCallback(
    async (fileDiff) => {
      if (cwd === undefined) throw new Error("Workspace unavailable");
      const diff = await orpcClient.git.diff({
        cwd,
        path: fileDiff.name,
        mode,
        ...(mode === "branch" && other !== undefined ? { other } : {}),
      });
      return toLoadedDiffFiles(fileDiff, diff);
    },
    [cwd, mode, orpcClient, other],
  );
}
