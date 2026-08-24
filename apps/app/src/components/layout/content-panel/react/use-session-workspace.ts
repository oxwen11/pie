import type { SessionWorkspace } from "@getpie/contract";

import { useProject } from "@/features/projects/use-projects";

import { useContentPanelContext } from "./context";

export type SessionWorkspaceView = {
  readonly path: string;
  readonly name: string;
  readonly gitBranch?: string;
};

export const toSessionWorkspaceView = (
  workspace: SessionWorkspace,
  projectName: string,
): SessionWorkspaceView => ({
  path: workspace.cwd,
  // Always the project name — branch is metadata for the header, not the tree root label.
  name: projectName,
  ...(workspace.gitBranch !== undefined ? { gitBranch: workspace.gitBranch } : {}),
});

/** Resolve the session's working directory from the content-panel context. */
export function useSessionWorkspace(
  projectId: string | undefined,
): SessionWorkspaceView | undefined {
  const { workspace } = useContentPanelContext();
  const project = useProject(projectId);
  if (workspace === null || project === undefined) return undefined;
  return toSessionWorkspaceView(workspace, project.name);
}
