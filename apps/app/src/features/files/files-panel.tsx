import { Button } from "@getpie/ui/components/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyMedia,
  EmptyTitle,
} from "@getpie/ui/components/empty";
import { FilesIcon, FileTextIcon } from "lucide-react";
import { useCallback } from "react";

import type { PanelHandle } from "@/components/layout/content-panel/model/panel";
import { useContentPanel } from "@/components/layout/content-panel/react/hooks";
import { definePanel } from "@/components/layout/content-panel/react/view";

import { filePanel } from "./file-panel";
import { FileState } from "./file-state";
import { FileWorkspaceLayout } from "./file-workspace-layout";
import { useGitBranch } from "./use-git-branch";
import { useProjectName } from "./use-project-name";
import { useWorkspaceTree } from "./use-workspace-tree";
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
  const projectName = useProjectName(instance.sessionRef.projectId);
  const panel = useContentPanel();
  const workspace = { ref: instance.sessionRef };
  const tree = useWorkspaceTree(workspace);
  const branch = useGitBranch(workspace);
  const openFile = useCallback(
    (path: string) => {
      if (panel === null) return;
      panel.replace(instance.id, filePanel, { path });
    },
    [instance, panel],
  );

  if (panel === null) {
    return (
      <WorkspaceState title="Workspace unavailable">
        This session no longer resolves to an imported project.
      </WorkspaceState>
    );
  }

  const workspaceName = projectName ?? "Workspace";
  const workspacePath = tree.data?.cwd ?? "";
  const gitBranch = branch.data?.current ?? undefined;

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

function WorkspaceState({
  title,
  children,
  onRetry,
}: {
  title: string;
  children: string;
  onRetry?: () => void;
}) {
  return (
    <Empty className="py-8 md:py-8">
      <EmptyMedia variant="icon">
        <FilesIcon />
      </EmptyMedia>
      <EmptyContent>
        <div>
          <EmptyTitle className="text-base">{title}</EmptyTitle>
          <EmptyDescription>{children}</EmptyDescription>
        </div>
        {onRetry ? (
          <Button onClick={onRetry} size="sm" variant="outline">
            Try again
          </Button>
        ) : null}
      </EmptyContent>
    </Empty>
  );
}
