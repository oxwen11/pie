import { ORPCError } from "@orpc/client";
import { Spinner } from "@vibest/ui/components/spinner";
import { GitCompareIcon } from "lucide-react";
import { useCallback } from "react";

import { asRecord, type PanelHandle } from "@/components/layout/content-panel/core/panel";
import { definePanel } from "@/components/layout/content-panel/react/view";

import { ReviewDiffPane } from "./review-diff-pane";
import { ReviewFileList } from "./review-file-list";
import { ReviewState } from "./review-state";
import { ReviewWorkspaceLayout } from "./review-workspace-layout";
import { useGitDiff } from "./use-git-diff";
import { useGitReview } from "./use-git-review";
import { useSessionWorkspace } from "./use-session-workspace";

export interface ReviewPayload {
  readonly path?: string;
}

export const reviewPanel = definePanel({
  type: "review",
  label: "Review",
  newPayload: () => ({}),
  parse: (raw) => {
    const record = asRecord(raw);
    if (record === null) return {};
    return typeof record.path === "string" ? { path: record.path } : {};
  },
  view: {
    icon: GitCompareIcon,
    render: (instance) => <ReviewPanelView instance={instance} />,
  },
});

function ReviewPanelView({ instance }: { instance: PanelHandle<ReviewPayload> }) {
  const workspace = useSessionWorkspace();
  const cwd = workspace.data?.path;
  const review = useGitReview(cwd);
  const selectedPath = instance.payload.path;
  const diff = useGitDiff(cwd, selectedPath);
  const selectFile = useCallback((path: string) => instance.setPayload({ path }), [instance]);

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

  if (!workspace.data || cwd === undefined) {
    return (
      <ReviewState title="Workspace unavailable">
        This session no longer resolves to an imported project.
      </ReviewState>
    );
  }

  if (review.isPending) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <Spinner className="text-muted-foreground size-4" />
      </div>
    );
  }

  if (review.isError) {
    return (
      <ReviewState title={reviewErrorTitle(review.error)} onRetry={() => void review.refetch()}>
        {reviewErrorMessage(review.error)}
      </ReviewState>
    );
  }

  if (review.data.files.length === 0) {
    return (
      <ReviewState prominentIcon title="No changes to review">
        {review.data.baseBranch === null
          ? "The working tree matches HEAD."
          : `This branch has no changes against ${review.data.baseBranch}.`}
      </ReviewState>
    );
  }

  const refreshing = review.isFetching || diff.isFetching;
  const refresh = (): void => {
    void Promise.all([review.refetch(), selectedPath === undefined ? undefined : diff.refetch()]);
  };

  return (
    <ReviewWorkspaceLayout
      files={
        <ReviewFileList
          onRefresh={refresh}
          onSelect={selectFile}
          refreshing={refreshing}
          review={review.data}
          selectedPath={selectedPath}
        />
      }
      filesLabel={workspace.data.name}
      preview={
        <ReviewDiffPane
          diff={diff}
          onRefresh={refresh}
          path={selectedPath}
          refreshing={refreshing}
        />
      }
    />
  );
}

function reviewErrorTitle(error: Error): string {
  if (error instanceof ORPCError && error.code === "NOT_REPOSITORY") {
    return "Not a Git repository";
  }
  return "Unable to load review";
}

function reviewErrorMessage(error: Error): string {
  if (error instanceof ORPCError && error.code === "NOT_REPOSITORY") {
    return "Open a Git project to review the branch against its default base.";
  }
  return error.message;
}
