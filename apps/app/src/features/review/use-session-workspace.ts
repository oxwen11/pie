import type { Project } from "@pie/contract";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { useRouteContext } from "@tanstack/react-router";
import { useCallback } from "react";

/** Resolve a session's project to its workspace path from the panel's SessionRef. */
export function useSessionWorkspace(
  projectId: string | undefined,
): UseQueryResult<Project | undefined> {
  const { orpcQueryUtils } = useRouteContext({ from: "__root__" });
  return useQuery({
    ...orpcQueryUtils.project.list.queryOptions(),
    staleTime: Infinity,
    select: useCallback(
      (projects: ReadonlyArray<Project>) =>
        projectId === undefined ? undefined : projects.find((project) => project.id === projectId),
      [projectId],
    ),
  });
}
