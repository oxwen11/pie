import { Spinner } from "@getpie/ui/components/spinner";
import type { FileDiffContentsLoader } from "@pierre/diffs";
import { lazy, Suspense } from "react";

import { emptyReviewMessage } from "./review-file-status";
import { ReviewState } from "./review-state";
import type { GitPatchQuery } from "./use-git-patch";

const ReviewDiffAdapter = lazy(() =>
  import("./review-diff-adapter").then((module) => ({ default: module.ReviewDiffAdapter })),
);

export function ReviewDiffPane({
  review,
  loadDiffFiles,
  path,
  locateRequest,
}: {
  review: GitPatchQuery;
  loadDiffFiles: FileDiffContentsLoader;
  path?: string;
  locateRequest: number;
}) {
  if (review.data !== undefined && review.data.files.length === 0) {
    return (
      <ReviewState prominentIcon title="No changes to review">
        {emptyReviewMessage(review.data)}
      </ReviewState>
    );
  }

  if (review.data === undefined) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <Spinner className="text-muted-foreground size-4" />
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1">
      <Suspense
        fallback={
          <div className="flex h-full items-center justify-center">
            <Spinner className="text-muted-foreground size-4" />
          </div>
        }
      >
        <ReviewDiffAdapter
          files={review.data.files}
          issues={review.data.issues}
          loadDiffFiles={loadDiffFiles}
          locatePath={path}
          locateRequest={locateRequest}
          patch={review.data.patch}
        />
      </Suspense>
    </div>
  );
}
