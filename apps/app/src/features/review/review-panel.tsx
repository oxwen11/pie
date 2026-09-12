import type { Project, WorkspaceQuery } from "@getpie/contract";
import type { WorkspaceTreeResult } from "@getpie/contract/fs";
import {
  type GitFileDiff,
  type GitRepositoryBranch,
  type GitReview,
  type GitReviewFile,
  type GitReviewMode,
  isGitRepositoryBranch,
} from "@getpie/contract/git";
import { Spinner } from "@getpie/ui/components/spinner";
import { ORPCError } from "@orpc/client";
import { skipToken, useQueries, useQuery, type UseQueryResult } from "@tanstack/react-query";
import { useRouteContext } from "@tanstack/react-router";
import { GitCompareIcon } from "lucide-react";
import { useCallback, useState, type ReactNode } from "react";

import { asRecord, type PanelHandle } from "@/components/layout/content-panel/model/panel";
import { useContentPanel } from "@/components/layout/content-panel/react/hooks";
import { definePanel } from "@/components/layout/content-panel/react/view";

import { ReviewDiffPane } from "./review-diff-pane";
import { isReviewMode, reviewHeading } from "./review-file-status";
import { ReviewState } from "./review-state";
import { ReviewToolbar } from "./review-toolbar";
import { ReviewTreePane } from "./review-tree-pane";
import { ReviewWorkspaceLayout } from "./review-workspace-layout";

export interface ReviewPayload {
  readonly mode?: GitReviewMode;
  readonly other?: string;
  readonly path?: string;
}

function reviewInput(workspace: WorkspaceQuery, mode: GitReviewMode, other: string | undefined) {
  if (mode === "branch" && other === undefined) return skipToken;
  return {
    ...workspace,
    mode,
    ...(mode === "branch" ? { other } : undefined),
  };
}

function diffInput(
  workspace: WorkspaceQuery,
  file: GitReviewFile,
  mode: GitReviewMode,
  other: string | undefined,
) {
  const base = reviewInput(workspace, mode, other);
  return base === skipToken ? skipToken : { ...base, path: file.path };
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
      ...(path === undefined ? undefined : { path }),
      ...(mode === undefined ? undefined : { mode }),
      ...(other === undefined ? undefined : { other }),
    };
  },
  view: {
    icon: GitCompareIcon,
    render: (instance) => <ReviewPanelView instance={instance} />,
  },
});

function ReviewPanelView({ instance }: { instance: PanelHandle<ReviewPayload> }) {
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
  const gitWorkspace = { ref: instance.sessionRef };
  const panel = useContentPanel();
  const mode = reviewModeOf(instance.payload.mode);
  const branch = useQuery({
    ...orpcQueryUtils.git.branch.queryOptions({ input: gitWorkspace }),
    meta: { errorMode: "inline" },
  });
  const branchData = branch.data;
  const repositoryBranch = isGitRepositoryBranch(branchData) ? branchData : undefined;
  const defaultBranch = repositoryBranch?.defaultBranch;
  const other = reviewCompareOther(mode, instance.payload.other, defaultBranch);
  const review = useQuery(
    orpcQueryUtils.git.review.queryOptions({
      input: skipUnlessBranch(repositoryBranch, reviewInput(gitWorkspace, mode, other)),
    }),
  );
  const tree = useQuery(
    orpcQueryUtils.fs.readTree.queryOptions({
      input: skipUnlessBranch(repositoryBranch, gitWorkspace),
    }),
  );
  const diffs = useQueries({
    queries: reviewFiles(review.data).map((file) =>
      orpcQueryUtils.git.diff.queryOptions({
        input: diffInput(gitWorkspace, file, mode, other),
      }),
    ),
  });
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
          const nextOther = current.other ?? defaultBranch ?? undefined;
          return {
            ...current,
            mode: next,
            ...(nextOther === undefined ? undefined : { other: nextOther }),
          };
        }
        const { other: _other, ...rest } = current;
        return { ...rest, mode: next };
      });
    },
    [instance, defaultBranch],
  );

  const setOther = useCallback(
    (next: string) => {
      instance.setPayload((current) => ({ ...current, mode: "branch", other: next }));
    },
    [instance],
  );

  const placeholder = reviewPanelPlaceholder({
    panel,
    branchIsPending: branch.isPending,
    branchHasData: branch.data !== undefined,
    branchIsError: branch.isError,
    branchErrorMessage: branch.error?.message,
    onRetryBranch: () => void branch.refetch(),
    branchKind: branchData?.kind,
    mode,
    other,
    reviewIsPending: review.isPending,
    reviewHasData: review.data !== undefined,
    reviewIsError: review.isError,
    reviewError: review.error,
    onRetryReview: () => void review.refetch(),
  });
  if (placeholder !== null) return placeholder;
  if (panel === null) return null;

  return (
    <ReviewPanelReady
      diffs={diffs}
      heading={reviewHeadingText(review.data)}
      locateRequest={locateRequest}
      mode={mode}
      other={other}
      panel={panel}
      refreshing={reviewRefreshing(review.isFetching, branch.isFetching, tree.isFetching)}
      repositoryBranch={repositoryBranch}
      review={review}
      selectedPath={selectedPath}
      selectFile={selectFile}
      setMode={setMode}
      setOther={setOther}
      tree={tree}
      workspaceName={workspaceLabel(projectName)}
      workspacePath={workspacePathOf(tree.data?.cwd)}
      onRefresh={() => {
        void Promise.all([
          review.refetch(),
          branch.refetch(),
          tree.refetch(),
          ...diffs.map((diff) => diff.refetch()),
        ]);
      }}
    />
  );
}

function reviewModeOf(mode: GitReviewMode | undefined): GitReviewMode {
  return mode ?? "uncommitted";
}

function reviewCompareOther(
  mode: GitReviewMode,
  payloadOther: string | undefined,
  defaultBranch: string | undefined,
): string | undefined {
  if (mode !== "branch") return undefined;
  return payloadOther ?? defaultBranch;
}

function skipUnlessBranch<T>(
  repositoryBranch: GitRepositoryBranch | undefined,
  value: T,
): T | typeof skipToken {
  if (repositoryBranch === undefined) return skipToken;
  return value;
}

function reviewFiles(review: GitReview | undefined): ReadonlyArray<GitReviewFile> {
  return review?.files ?? [];
}

function reviewHeadingText(review: GitReview | undefined): string {
  if (review === undefined) return "";
  return reviewHeading(review);
}

function workspaceLabel(projectName: string | undefined): string {
  return projectName ?? "Workspace";
}

function workspacePathOf(cwd: string | undefined): string {
  return cwd ?? "";
}

function reviewRefreshing(
  reviewFetching: boolean,
  branchFetching: boolean,
  treeFetching: boolean,
): boolean {
  return reviewFetching || branchFetching || treeFetching;
}

function reviewDiffKey(mode: GitReviewMode, other: string | undefined): string {
  return `${mode}:${other ?? ""}`;
}

function ReviewPanelReady({
  diffs,
  heading,
  locateRequest,
  mode,
  other,
  panel,
  refreshing,
  repositoryBranch,
  review,
  selectedPath,
  selectFile,
  setMode,
  setOther,
  tree,
  workspaceName,
  workspacePath,
  onRefresh,
}: {
  diffs: ReadonlyArray<UseQueryResult<GitFileDiff>>;
  heading: string;
  locateRequest: number;
  mode: GitReviewMode;
  other: string | undefined;
  panel: { sessionKey: string };
  refreshing: boolean;
  repositoryBranch: GitRepositoryBranch | undefined;
  review: UseQueryResult<GitReview>;
  selectedPath: string | undefined;
  selectFile: (path: string) => void;
  setMode: (mode: GitReviewMode) => void;
  setOther: (other: string) => void;
  tree: UseQueryResult<WorkspaceTreeResult>;
  workspaceName: string;
  workspacePath: string;
  onRefresh: () => void;
}) {
  return (
    <ReviewWorkspaceLayout
      files={
        <ReviewTreePane
          files={reviewFiles(review.data)}
          onSelectFile={selectFile}
          sessionId={panel.sessionKey}
          tree={tree}
          workspaceName={workspaceName}
          workspacePath={workspacePath}
        />
      }
      filesLabel={workspaceName}
      preview={
        <ReviewDiffPane
          diffs={diffs}
          key={reviewDiffKey(mode, other)}
          locateRequest={locateRequest}
          path={selectedPath}
          review={review}
        />
      }
      toolbar={
        <ReviewToolbar
          branch={repositoryBranch}
          heading={heading}
          mode={mode}
          onModeChange={setMode}
          onOtherChange={setOther}
          onRefresh={onRefresh}
          other={other}
          refreshing={refreshing}
        />
      }
    />
  );
}

function ReviewSpinner() {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center">
      <Spinner className="text-muted-foreground size-4" />
    </div>
  );
}

function reviewPanelPlaceholder({
  panel,
  branchIsPending,
  branchHasData,
  branchIsError,
  branchErrorMessage,
  onRetryBranch,
  branchKind,
  mode,
  other,
  reviewIsPending,
  reviewHasData,
  reviewIsError,
  reviewError,
  onRetryReview,
}: {
  panel: { sessionKey: string } | null;
  branchIsPending: boolean;
  branchHasData: boolean;
  branchIsError: boolean;
  branchErrorMessage: string | undefined;
  onRetryBranch: () => void;
  branchKind: "repository" | "not-repository" | "workspace-unavailable" | undefined;
  mode: GitReviewMode;
  other: string | undefined;
  reviewIsPending: boolean;
  reviewHasData: boolean;
  reviewIsError: boolean;
  reviewError: Error | null;
  onRetryReview: () => void;
}): ReactNode {
  if (panel === null) {
    return (
      <ReviewState title="Workspace unavailable">
        This session no longer resolves to an imported project.
      </ReviewState>
    );
  }
  if (branchIsPending && !branchHasData) return <ReviewSpinner />;
  if (branchIsError && !branchHasData) {
    return (
      <ReviewState onRetry={onRetryBranch} title="Unable to inspect repository">
        {branchErrorMessage}
      </ReviewState>
    );
  }
  if (branchKind === "not-repository") {
    return (
      <ReviewState title="Not a Git repository">
        Open a Git project to review uncommitted work, commits, or another branch.
      </ReviewState>
    );
  }
  if (branchKind === "workspace-unavailable") {
    return (
      <ReviewState title="Workspace unavailable">
        This session&apos;s workspace folder no longer exists or cannot be read.
      </ReviewState>
    );
  }
  if (mode === "branch" && other === undefined && !branchIsPending) {
    return (
      <ReviewState title="Compare branch not found">
        This repository has no local default branch or remote-tracking ref to compare against.
      </ReviewState>
    );
  }
  if ((reviewIsPending && !reviewHasData) || (mode === "branch" && other === undefined)) {
    return <ReviewSpinner />;
  }
  if (reviewIsError && !reviewHasData && reviewError !== null) {
    return (
      <ReviewState onRetry={onRetryReview} title={reviewErrorTitle(reviewError)}>
        {reviewErrorMessage(reviewError)}
      </ReviewState>
    );
  }
  return null;
}

function reviewErrorTitle(error: Error): string {
  if (!(error instanceof ORPCError)) return "Unable to load review";
  switch (error.code) {
    case "NOT_REPOSITORY":
      return "Not a Git repository";
    case "REF_NOT_FOUND":
      return "Compare branch not found";
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
    default:
      return error.message;
  }
}
