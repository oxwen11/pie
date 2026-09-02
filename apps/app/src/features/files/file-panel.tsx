import type { Project } from "@getpie/contract";
import { useQuery } from "@tanstack/react-query";
import { useRouteContext } from "@tanstack/react-router";
import { FileCodeIcon } from "lucide-react";
import { useCallback, useSyncExternalStore } from "react";

import { asRecord, type PanelHandle } from "@/components/layout/content-panel/model/panel";
import { useContentPanel } from "@/components/layout/content-panel/react/hooks";
import { definePanelFamily } from "@/components/layout/content-panel/react/view";
import {
  WorkspaceLayout,
  WorkspaceLayoutBody,
  WorkspaceLayoutPreview,
  WorkspaceLayoutSeparator,
  WorkspaceLayoutTree,
  WorkspaceLayoutTreeTrigger,
} from "@/components/layout/workspace-layout";

import { createFileNavigationTracker, type FileNavigationTracker } from "./file-navigation";
import { FilePreviewPane } from "./file-preview-pane";
import { FileState } from "./file-state";
import { WorkspaceTreePane } from "./workspace-tree-pane";

export interface FilePayload {
  readonly path: string;
  /** Where a jump-to-line request last pointed. Part of the payload so it survives a reload. */
  readonly line?: number;
}

const fileName = (path: string): string => path.split(/[\\/]/).at(-1) || path;

export const filePanel = definePanelFamily({
  type: "file",
  key: (payload: FilePayload) => payload.path,
  label: (payload) => fileName(payload.path),
  title: "File",
  parse: (raw) => {
    const { path, line } = asRecord(raw) ?? {};
    if (typeof path !== "string") return null;
    return typeof line === "number" ? { path, line } : { path };
  },
  create: () => {
    const navigation = createFileNavigationTracker();
    return {
      navigation,
      reopen: navigation.request,
      dispose: navigation.dispose,
    };
  },
  view: {
    icon: FileCodeIcon,
    render: (instance) => <FilePanelView instance={instance} />,
  },
});

type FilePanelHandle = PanelHandle<FilePayload> & {
  readonly navigation: FileNavigationTracker;
};

function FilePanelView({ instance }: { instance: FilePanelHandle }) {
  const { path, line } = instance.payload;
  const navigationRequest = useSyncExternalStore(
    instance.navigation.subscribe,
    instance.navigation.getSnapshot,
    instance.navigation.getSnapshot,
  );
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
  const file = useQuery(
    orpcQueryUtils.fs.readFileString.queryOptions({
      input: { ref: instance.sessionRef, path },
    }),
  );
  const openFile = useCallback(
    (nextPath: string) => panel?.open(filePanel, { path: nextPath }),
    [panel],
  );

  if (panel === null) {
    return (
      <FileState title="Workspace unavailable">
        This session no longer resolves to an imported project.
      </FileState>
    );
  }

  const workspaceName = projectName ?? "Workspace";
  const workspacePath = tree.data?.cwd ?? "";
  const gitBranch =
    branch.data?.kind === "repository" ? (branch.data.current ?? undefined) : undefined;
  const refreshing = file.isFetching || tree.isFetching;
  const refresh = (): void => {
    void Promise.all([file.refetch(), tree.refetch()]);
  };
  const preview = (
    <FilePreviewPane
      file={file}
      line={line}
      navigationRequest={navigationRequest}
      onRefresh={refresh}
      path={path}
      refreshing={refreshing}
    />
  );
  const treePane = (
    <WorkspaceTreePane
      gitBranch={gitBranch}
      onOpenFile={openFile}
      onRefresh={refresh}
      refreshing={refreshing}
      sessionId={panel.sessionKey}
      tree={tree}
      workspaceName={workspaceName}
      workspacePath={workspacePath}
    />
  );

  return (
    <WorkspaceLayout>
      <WorkspaceLayoutBody>
        <WorkspaceLayoutPreview>{preview}</WorkspaceLayoutPreview>
        <WorkspaceLayoutTreeTrigger className="absolute end-11 top-1.5 z-10" label={path} />
        <WorkspaceLayoutSeparator />
        <WorkspaceLayoutTree>{treePane}</WorkspaceLayoutTree>
      </WorkspaceLayoutBody>
    </WorkspaceLayout>
  );
}
