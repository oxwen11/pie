import type { GitReviewMode } from "@getpie/contract/git";
import { Spinner } from "@getpie/ui/components/spinner";
import { ORPCError } from "@orpc/client";
import { useQuery } from "@tanstack/react-query";
import { useRouteContext } from "@tanstack/react-router";
import { GitCompareIcon } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import { asRecord, type PanelHandle } from "@/components/layout/content-panel/model/panel";
import { useContentPanelContext } from "@/components/layout/content-panel/react/context";
import { useContentPanel } from "@/components/layout/content-panel/react/hooks";
import { definePanel } from "@/components/layout/content-panel/react/view";

import { ReviewDiffPane } from "./review-diff-pane";
import { isReviewMode, reviewHeading } from "./review-file-status";
import { ReviewState } from "./review-state";
import { ReviewToolbar } from "./review-toolbar";
import { ReviewTreePane } from "./review-tree-pane";
import { ReviewWorkspaceLayout } from "./review-workspace-layout";
import { useGitDiffs } from "./use-git-diffs";
import { useGitReview } from "./use-git-review";

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
  const { orpcQueryUtils } = useRouteContext({ from: "__root__" });
  const { projectName } = useContentPanelContext();
  const gitWorkspace = { ref: instance.sessionRef };
  const panel = useContentPanel();
  const mode = instance.payload.mode ?? "uncommitted";
  const branch = useQuery({
    ...orpcQueryUtils.git.branch.queryOptions({ input: gitWorkspace }),
    refetchOnWindowFocus: "always",
    staleTime: Infinity,
  });
  const other =
    mode === "branch"
      ? (instance.payload.other ?? branch.data?.defaultBranch ?? undefined)
      : undefined;
  const review = useGitReview(gitWorkspace, mode, other);
  const tree = useQuery({
    ...orpcQueryUtils.fs.readTree.queryOptions({ input: gitWorkspace }),
    refetchOnWindowFocus: "always",
    staleTime: Infinity,
  });
  const diffs = useGitDiffs(gitWorkspace, review.data?.files ?? [], mode, other);
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

  if (panel === null) {
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

  const workspaceName = projectName ?? "Workspace";
  const workspacePath = tree.data?.cwd ?? "";
  const refreshing = review.isFetching || branch.isFetching || tree.isFetching;
  const refresh = (): void => {
    void Promise.all([
      review.refetch(),
      branch.refetch(),
      tree.refetch(),
      ...diffs.map((diff) => diff.refetch()),
    ]);
  };

  return (
    <ReviewWorkspaceLayout
      files={
        <ReviewTreePane
          files={review.data?.files ?? []}
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
          key={`${mode}:${other ?? ""}`}
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
