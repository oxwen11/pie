import type { Project } from "@getpie/contract";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { useCallback } from "react";

import { useLocalAppClients } from "@/lib/app-clients";

/**
 * Shared `project.list` readers. Writers are the import dialog and draft
 * allocate (both update this cache on success).
 */
function useProjectListQuery<TData>(
  select: (projects: ReadonlyArray<Project>) => TData,
): UseQueryResult<TData> {
  const { orpcQueryUtils } = useLocalAppClients();
  return useQuery({
    ...orpcQueryUtils.project.list.queryOptions(),
    select,
  });
}

// Oldest-first, so importing a project appends to the bottom of the sidebar.
// Module scope: an inline closure would re-run `select` every render.
const selectProjects = (projects: ReadonlyArray<Project>): ReadonlyArray<Project> =>
  Array.from(projects)
    .filter((project) => project.type !== "chat")
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

const selectChatNewestFirst = (projects: ReadonlyArray<Project>): ReadonlyArray<Project> =>
  Array.from(projects)
    .filter((project) => project.type === "chat")
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

/** Imported folders only — the Projects picker and sidebar group. */
export function useProjects(): UseQueryResult<ReadonlyArray<Project>> {
  return useProjectListQuery(selectProjects);
}

/** Chat projects (`type: "chat"`), newest first — the Recent sidebar group. */
export function useChatProjects(): UseQueryResult<ReadonlyArray<Project>> {
  return useProjectListQuery(selectChatNewestFirst);
}

/**
 * One project by id, or undefined when the list hasn't landed or no longer
 * knows that id — a URL carrying a since-removed projectId reads as nothing
 * selected. `select` closes over `projectId`, so it must be memoised.
 */
export function useProject(projectId: string | null | undefined): Project | undefined {
  const { data } = useProjectListQuery(
    useCallback(
      (projects: ReadonlyArray<Project>) => projects.find((project) => project.id === projectId),
      [projectId],
    ),
  );
  return data;
}
