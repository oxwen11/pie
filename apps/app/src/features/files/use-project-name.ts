import type { Project } from "@getpie/contract";
import { useQuery } from "@tanstack/react-query";
import { useRouteContext } from "@tanstack/react-router";
import { useCallback } from "react";

/**
 * Project display name from the same `project.list` cache the shell uses.
 * Files cannot import `useProject` — features do not cross.
 */
export function useProjectName(projectId: string): string | undefined {
  const { orpcQueryUtils } = useRouteContext({ from: "__root__" });
  const { data } = useQuery({
    ...orpcQueryUtils.project.list.queryOptions(),
    staleTime: Infinity,
    select: useCallback(
      (projects: ReadonlyArray<Project>) =>
        projects.find((project) => project.id === projectId)?.name,
      [projectId],
    ),
  });
  return data;
}
