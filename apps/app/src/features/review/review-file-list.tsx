import type { GitReview, GitReviewFile, GitReviewFileStatus } from "@vibest/contract/git";
import { Button } from "@vibest/ui/components/button";
import { cn } from "@vibest/ui/lib/utils";
import { RefreshCwIcon } from "lucide-react";

import { REVIEW_STATUS_BADGE, REVIEW_STATUS_LABEL, reviewHeading } from "./review-file-status";

const STATUS_CLASS: Record<GitReviewFileStatus, string> = {
  modified: "text-amber-700 dark:text-amber-400",
  added: "text-emerald-700 dark:text-emerald-400",
  deleted: "text-rose-700 dark:text-rose-400",
  renamed: "text-sky-700 dark:text-sky-400",
  copied: "text-sky-700 dark:text-sky-400",
};

export function ReviewFileList({
  review,
  selectedPath,
  refreshing,
  onSelect,
  onRefresh,
}: {
  review: GitReview;
  selectedPath?: string;
  refreshing: boolean;
  onSelect: (path: string) => void;
  onRefresh: () => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b px-3 py-1.5">
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium">
            {reviewHeading(review.branch, review.baseBranch)}
          </p>
          <p className="text-muted-foreground truncate text-[11px]">
            {review.files.length === 1 ? "1 file" : `${review.files.length} files`}
          </p>
        </div>
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
      <ul className="min-h-0 flex-1 overflow-y-auto py-1">
        {review.files.map((file) => (
          <ReviewFileRow
            file={file}
            key={file.path}
            onSelect={onSelect}
            selected={file.path === selectedPath}
          />
        ))}
      </ul>
    </div>
  );
}

function ReviewFileRow({
  file,
  selected,
  onSelect,
}: {
  file: GitReviewFile;
  selected: boolean;
  onSelect: (path: string) => void;
}) {
  const name = file.path.split("/").at(-1) || file.path;
  return (
    <li>
      <button
        aria-current={selected ? "true" : undefined}
        className={cn(
          "flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs",
          selected ? "bg-accent text-foreground" : "hover:bg-accent/60",
        )}
        onClick={() => onSelect(file.path)}
        title={file.oldPath === undefined ? file.path : `${file.oldPath} → ${file.path}`}
        type="button"
      >
        <span
          aria-label={REVIEW_STATUS_LABEL[file.status]}
          className={cn(
            "w-3 shrink-0 font-mono text-[11px] font-medium",
            STATUS_CLASS[file.status],
          )}
        >
          {REVIEW_STATUS_BADGE[file.status]}
        </span>
        <span className="min-w-0 flex-1 truncate">{name}</span>
      </button>
    </li>
  );
}
