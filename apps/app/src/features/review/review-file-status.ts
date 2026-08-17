import type { GitReviewFileStatus } from "@vibest/contract/git";

export const REVIEW_STATUS_LABEL: Record<GitReviewFileStatus, string> = {
  modified: "Modified",
  added: "Added",
  deleted: "Deleted",
  renamed: "Renamed",
  copied: "Copied",
};

export const REVIEW_STATUS_BADGE: Record<GitReviewFileStatus, string> = {
  modified: "M",
  added: "A",
  deleted: "D",
  renamed: "R",
  copied: "C",
};

export function reviewHeading(branch: string | null, baseBranch: string | null): string {
  if (branch !== null && baseBranch !== null) return `${branch} → ${baseBranch}`;
  if (branch !== null) return `Uncommitted changes on ${branch}`;
  return "Uncommitted changes";
}
