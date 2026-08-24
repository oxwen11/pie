import type { GitReviewMode } from "@getpie/contract/git";
import { Spinner } from "@getpie/ui/components/spinner";
import { ORPCError } from "@orpc/client";
import { GitCompareIcon } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import { asRecord, type PanelHandle } from "@/components/layout/content-panel/model/panel";
import { useContentPanel } from "@/components/layout/content-panel/react/hooks";
import { definePanel } from "@/components/layout/content-panel/react/view";

import { ReviewDiffPane } from "./review-diff-pane";
import { isReviewMode, reviewHeading } from "./review-file-status";
import { ReviewState } from "./review-state";
import { ReviewToolbar } from "./review-toolbar";
import { ReviewTreePane } from "./review-tree-pane";
import { ReviewWorkspaceLayout } from "./review-workspace-layout";
import { useGitBranch } from "./use-git-branch";
import { useGitDiffLoader } from "./use-git-diff-loader";
import { useGitPatch } from "./use-git-patch";
import { useSessionWorkspace } from "./use-session-workspace";
import { useWorkspaceTree } from "./use-workspace-tree";

export interface ReviewPayload {
  readonly mode?: GitReviewMode;
  readonly other?: string;
  readonly path?: string;
}

export const reviewPanel = definePanel({
  type: "review",
  label: "Review",
  newPayload: () => ({}),
  parse: (raw) => {
    const record = asRecord(raw);
    if (record === null) return {};
    const path = typeof record.path === "string" ? record.path : undefined;
    const mode = isReviewMode(record.mode) ? record.mode : undefined;
    const other = typeof record.other === "string" ? record.other : undefined;
    return {
      ...(path === undefined ? {} : { path }),
      ...(mode === undefined ? {} : { mode }),
      ...(other === undefined ? {} : { other }),
    };
  },
  view: {
    icon: GitCompareIcon,
    render: (instance) => <ReviewPanelView instance={instance} />,
  },
});

function ReviewPanelView({ instance }: { instance: PanelHandle<ReviewPayload> }) {
  const workspace = useSessionWorkspace(instance.sessionRef.projectId);
  const panel = useContentPanel();
  const cwd = workspace.data?.path;
  const mode = instance.payload.mode ?? "uncommitted";
  const branch = useGitBranch(cwd);
  const other =
    mode === "branch"
      ? (instance.payload.other ?? branch.data?.defaultBranch ?? undefined)
      : undefined;
  const review = useGitPatch(cwd, mode, other);
  const loadDiffFiles = useGitDiffLoader(cwd, mode, other);
  const tree = useWorkspaceTree(cwd);
  const [locateRequest, setLocateRequest] = useState(0);
  const selectedPath = instance.payload.path;

  const selectFile = useCallback(
    (path: string) => {
      instance.setPayload((current) => ({ ...current, path }));
      setLocateRequest((current) => current + 1);
    },
    [instance],
  );

  const setMode = useCallback(
    (next: GitReviewMode) => {
      instance.setPayload((current) => {
        if (next === "branch") {
          const nextOther = current.other ?? branch.data?.defaultBranch ?? undefined;
          return {
            ...current,
            mode: next,
            ...(nextOther === undefined ? {} : { other: nextOther }),
          };
        }
        const { other: _other, ...rest } = current;
        return { ...rest, mode: next };
      });
    },
    [branch.data?.defaultBranch, instance],
  );

  const setOther = useCallback(
    (next: string) => {
      instance.setPayload((current) => ({ ...current, mode: "branch", other: next }));
    },
    [instance],
  );

  const heading = useMemo(
    () => (review.data === undefined ? "" : reviewHeading(review.data)),
    [review.data],
  );

  if (workspace.isPending) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <Spinner className="text-muted-foreground size-4" />
      </div>
    );
  }

  if (workspace.isError) {
    return (
      <ReviewState title="Unable to load workspace" onRetry={() => void workspace.refetch()}>
        The project list could not be loaded.
      </ReviewState>
    );
  }

  if (!workspace.data || cwd === undefined || panel === null) {
    return (
      <ReviewState title="Workspace unavailable">
        This session no longer resolves to an imported project.
      </ReviewState>
    );
  }

  if (mode === "branch" && other === undefined && !branch.isPending) {
    return (
      <ReviewState title="Compare branch not found">
        This repository has no local default branch or remote-tracking ref to compare against.
      </ReviewState>
    );
  }

  if (
    (review.isPending && review.data === undefined) ||
    (mode === "branch" && other === undefined)
  ) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <Spinner className="text-muted-foreground size-4" />
      </div>
    );
  }

  if (review.isError && review.data === undefined) {
    return (
      <ReviewState title={reviewErrorTitle(review.error)} onRetry={() => void review.refetch()}>
        {reviewErrorMessage(review.error)}
      </ReviewState>
    );
  }

  const refreshing = review.isFetching || branch.isFetching || tree.isFetching;
  const refresh = (): void => {
    void Promise.all([review.refetch(), branch.refetch(), tree.refetch()]);
  };

  return (
    <ReviewWorkspaceLayout
      files={
        <ReviewTreePane
          files={review.data?.files ?? []}
          onSelectFile={selectFile}
          sessionId={panel.sessionKey}
          tree={tree}
          workspaceName={workspace.data.name}
          workspacePath={workspace.data.path}
        />
      }
      filesLabel={workspace.data.name}
      preview={
        <ReviewDiffPane
          key={`${mode}:${other ?? ""}`}
          loadDiffFiles={loadDiffFiles}
          locateRequest={locateRequest}
          path={selectedPath}
          review={review}
        />
      }
      toolbar={
        <ReviewToolbar
          branch={branch.data}
          heading={heading}
          mode={mode}
          onModeChange={setMode}
          onOtherChange={setOther}
          onRefresh={refresh}
          other={other}
          refreshing={refreshing}
        />
      }
    />
  );
}

function reviewErrorTitle(error: Error): string {
  if (!(error instanceof ORPCError)) return "Unable to load review";
  switch (error.code) {
    case "NOT_REPOSITORY":
      return "Not a Git repository";
    case "REF_NOT_FOUND":
      return "Compare branch not found";
    case "PATCH_TOO_LARGE":
      return "Review too large";
    default:
      return "Unable to load review";
  }
}

function reviewErrorMessage(error: Error): string {
  if (!(error instanceof ORPCError)) return error.message;
  switch (error.code) {
    case "NOT_REPOSITORY":
      return "Open a Git project to review uncommitted work, commits, or another branch.";
    case "REF_NOT_FOUND":
      return "Pick a local branch or a remote-tracking ref that already exists.";
    case "PATCH_TOO_LARGE": {
      const data = error.data as { limit?: number } | undefined;
      return data?.limit === undefined
        ? "The review patch is too large to preview safely."
        : `The review patch exceeds the ${formatBytes(data.limit)} preview limit.`;
    }
    default:
      return error.message;
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kibibytes = bytes / 1024;
  if (kibibytes < 1024) return `${kibibytes.toFixed(1)} KiB`;
  return `${(kibibytes / 1024).toFixed(1)} MiB`;
}
