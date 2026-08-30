import type { Project } from "@getpie/contract";
import type { QueryClient, QueryKey } from "@tanstack/react-query";

import type { AppClients } from "@/lib/orpc";

export type ProjectCacheKeys = {
  readonly listModels: (projectId: string) => QueryKey;
  readonly modelStatePrefix: QueryKey;
  readonly projectList: QueryKey;
  readonly sessionList: (projectId: string, archived: boolean) => QueryKey;
};

export const projectCacheKeys = (
  orpcQueryUtils: AppClients["orpcQueryUtils"],
): ProjectCacheKeys => ({
  projectList: orpcQueryUtils.project.list.queryOptions().queryKey,
  sessionList: (projectId, archived) =>
    orpcQueryUtils.agent.session.list.queryOptions({ input: { projectId, archived } }).queryKey,
  listModels: (projectId) =>
    orpcQueryUtils.agent.listModels.queryOptions({ input: { projectId } }).queryKey,
  modelStatePrefix: orpcQueryUtils.agent.session.getModelState.key(),
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const modelStateBelongsToProject = (queryKey: QueryKey, projectId: string): boolean => {
  const options = queryKey.at(-1);
  if (!isRecord(options) || !isRecord(options.input) || !isRecord(options.input.ref)) return false;
  return options.input.ref.projectId === projectId;
};

export const removeProjectFromList = (
  queryClient: QueryClient,
  listKey: QueryKey,
  projectId: string,
): void => {
  queryClient.setQueryData<ReadonlyArray<Project>>(listKey, (projects) =>
    projects?.filter((project) => project.id !== projectId),
  );
};

/** Drop every TanStack entry whose server data was owned by one removed Project. */
export const removeProjectFromCache = (
  queryClient: QueryClient,
  keys: ProjectCacheKeys,
  projectId: string,
): void => {
  removeProjectFromList(queryClient, keys.projectList, projectId);
  queryClient.removeQueries({ queryKey: keys.sessionList(projectId, false) });
  queryClient.removeQueries({ queryKey: keys.sessionList(projectId, true) });
  queryClient.removeQueries({ queryKey: keys.listModels(projectId) });
  queryClient.removeQueries({
    queryKey: keys.modelStatePrefix,
    predicate: (query) => modelStateBelongsToProject(query.queryKey, projectId),
  });
};

export const notifyRemovedProjects = (
  previous: ReadonlyArray<Project> | undefined,
  current: ReadonlyArray<Project>,
  onRemoved: (projectId: string) => void,
): void => {
  if (previous === undefined) return;
  const currentIds = new Set(current.map((project) => project.id));
  for (const project of previous) {
    if (!currentIds.has(project.id)) onRemoved(project.id);
  }
};
