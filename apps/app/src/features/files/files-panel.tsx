import type { Project } from "@getpie/contract";
import { useQuery } from "@tanstack/react-query";
import { useRouteContext } from "@tanstack/react-router";
import { FilesIcon, FileTextIcon } from "lucide-react";
import { useCallback } from "react";

import type { PanelHandle } from "@/components/layout/content-panel/model/panel";
import { useContentPanel } from "@/components/layout/content-panel/react/hooks";
import { definePanel } from "@/components/layout/content-panel/react/view";
import { PanelEmptyState } from "@/components/layout/panel-empty-state";

import { filePanel } from "./file-panel";
import { FileState } from "./file-state";
import { FileWorkspaceLayout } from "./file-workspace-layout";
import { WorkspaceTreePane } from "./workspace-tree-pane";

export const filesPanel = definePanel({
  type: "files",
  label: "Files",
  view: {
    icon: FilesIcon,
    render: (instance) => <FilesPanelView instance={instance} />,
  },
});

function FilesPanelView({ instance }: { instance: PanelHandle<void> }) {
  const { orpcQueryUtils } = useRouteContext({ from: "__root__" });
  const projectId = instance.sessionRef.projectId;
  const { data: projectName } = useQuery({
    ...orpcQueryUtils.project.list.queryOptions(),
    // `select` closes over `projectId` — memoised so the query stays stable.
    select: useCallback(
      (projects: ReadonlyArray<Project>) =>
        projects.find((project) => project.id === projectId)?.name,
      [projectId],
    ),
  });
  const panel = useContentPanel();
  const workspace = { ref: instance.sessionRef };
  const tree = useQuery(orpcQueryUtils.fs.readTree.queryOptions({ input: workspace }));
  const branch = useQuery(orpcQueryUtils.git.branch.queryOptions({ input: workspace }));
  const openFile = useCallback(
    (path: string) => {
      if (panel === null) return;
      panel.replace(instance.id, filePanel, { path });
    },
    [instance, panel],
  );

  if (panel === null) {
    return (
      <PanelEmptyState icon={FilesIcon} title="Workspace unavailable">
        This session no longer resolves to an imported project.
      </PanelEmptyState>
    );
  }

  const workspaceName = projectName ?? "Workspace";
  const workspacePath = tree.data?.cwd ?? "";
  const gitBranch =
    branch.data?.kind === "repository" ? (branch.data.current ?? undefined) : undefined;

  const treePane = (
    <WorkspaceTreePane
      gitBranch={gitBranch}
      onOpenFile={openFile}
      sessionId={panel.sessionKey}
      tree={tree}
      workspaceName={workspaceName}
      workspacePath={workspacePath}
    />
  );

  return (
    <FileWorkspaceLayout
      preview={
        <FileState icon={FileTextIcon} prominentIcon title="打开文件">
          从工作区目录树中选择文件
        </FileState>
      }
      tree={treePane}
      treeLabel={workspaceName}
    />
  );
}
