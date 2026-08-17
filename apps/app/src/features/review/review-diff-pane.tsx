import { ORPCError } from "@orpc/client";
import type { UseQueryResult } from "@tanstack/react-query";
import type { GitFileDiff } from "@vibest/contract/git";
import { Button } from "@vibest/ui/components/button";
import { Spinner } from "@vibest/ui/components/spinner";
import { cn } from "@vibest/ui/lib/utils";
import { FileDiffIcon, RefreshCwIcon } from "lucide-react";
import { lazy, Suspense } from "react";

import { ReviewState } from "./review-state";

const ReviewDiffAdapter = lazy(() =>
  import("./review-diff-adapter").then((module) => ({ default: module.ReviewDiffAdapter })),
);

export function ReviewDiffPane({
  diff,
  path,
  refreshing,
  onRefresh,
}: {
  diff: UseQueryResult<GitFileDiff, Error>;
  path?: string;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b px-3">
        <span className="text-muted-foreground min-w-0 flex-1 truncate text-xs" title={path}>
          {path ?? "Select a file to review"}
        </span>
        <Button
          aria-label="Reload review"
          disabled={refreshing}
          onClick={onRefresh}
          size="icon-xs"
          variant="ghost"
        >
          <RefreshCwIcon className={cn("size-3.5", refreshing && "animate-spin")} />
        </Button>
      </div>
      {path === undefined ? (
        <ReviewState icon={FileDiffIcon} prominentIcon title="Review changes">
          Select a file from the change set to open its diff against the review base.
        </ReviewState>
      ) : diff.isPending ? (
        <div className="flex min-h-0 flex-1 items-center justify-center">
          <Spinner className="text-muted-foreground size-4" />
        </div>
      ) : diff.isError ? (
        <ReviewState title={diffErrorTitle(diff.error)} onRetry={() => void diff.refetch()}>
          {diffErrorMessage(diff.error)}
        </ReviewState>
      ) : (
        <div className="min-h-0 flex-1">
          <Suspense
            fallback={
              <div className="flex h-full items-center justify-center">
                <Spinner className="text-muted-foreground size-4" />
              </div>
            }
          >
            <ReviewDiffAdapter
              newContents={diff.data.newContents}
              oldContents={diff.data.oldContents}
              oldPath={diff.data.oldPath}
              path={diff.data.path}
            />
          </Suspense>
        </div>
      )}
    </div>
  );
}

function diffErrorTitle(error: Error): string {
  if (!(error instanceof ORPCError)) return "Unable to load diff";
  switch (error.code) {
    case "NOT_FOUND":
      return "File is no longer in the review";
    case "BINARY_FILE":
      return "Binary preview unavailable";
    case "FILE_TOO_LARGE":
      return "File too large to preview";
    default:
      return "Unable to load diff";
  }
}

function diffErrorMessage(error: Error): string {
  if (!(error instanceof ORPCError)) return error.message;
  switch (error.code) {
    case "NOT_FOUND":
      return "The file may have been committed, reverted, or renamed. Refresh the review.";
    case "BINARY_FILE":
      return "Binary preview unavailable.";
    case "FILE_TOO_LARGE": {
      const data = error.data as { size?: number; limit?: number } | undefined;
      const size = data?.size;
      const limit = data?.limit;
      if (size !== undefined && limit !== undefined) {
        return `${formatBytes(size)} exceeds the ${formatBytes(limit)} preview limit.`;
      }
      return "File too large to preview.";
    }
    case "PATH_ESCAPE":
      return "This path resolves outside the project workspace.";
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
