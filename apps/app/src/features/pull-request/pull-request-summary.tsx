import type { PullRequestSnapshot } from "@getpie/contract/pull-request";
import { Badge, type BadgeProps } from "@getpie/ui/components/badge";

import {
  checksSummaryLabel,
  mergeMethodLabel,
  pullRequestLifecycleLabel,
  pullRequestReviewLabel,
} from "./pull-request-presentation";

export function PullRequestSummary({ snapshot }: { snapshot: PullRequestSnapshot }) {
  const autoMerge = snapshot.autoMerge;
  return (
    <section aria-labelledby="pull-request-summary" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="pull-request-summary" className="text-base font-semibold">
          #{snapshot.ref.number}
        </h2>
        <Badge variant={lifecycleBadgeVariant(snapshot)}>
          {pullRequestLifecycleLabel(snapshot)}
        </Badge>
        <Badge variant={checksBadgeVariant(snapshot.checks.summary)}>
          {checksSummaryLabel(snapshot.checks.summary)}
        </Badge>
        {snapshot.mergeability === "conflicting" ? <Badge variant="error">Conflicts</Badge> : null}
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
        <dt className="text-muted-foreground">Branches</dt>
        <dd className="min-w-0 truncate font-mono text-xs">
          {snapshot.head.branch} → {snapshot.baseBranch}
        </dd>
        <dt className="text-muted-foreground">Head</dt>
        <dd className="font-mono text-xs">{snapshot.head.sha.slice(0, 12)}</dd>
        <dt className="text-muted-foreground">Review</dt>
        <dd>{pullRequestReviewLabel(snapshot)}</dd>
        <dt className="text-muted-foreground">Auto-merge</dt>
        <dd>{autoMerge === null ? "Off" : `On · ${mergeMethodLabel(autoMerge.method)}`}</dd>
      </dl>
    </section>
  );
}

function lifecycleBadgeVariant(snapshot: PullRequestSnapshot): BadgeProps["variant"] {
  if (snapshot.lifecycle.type === "merged") return "info";
  if (snapshot.lifecycle.type === "closed") return "error";
  if (snapshot.lifecycle.draft) return "secondary";
  return "success";
}

function checksBadgeVariant(
  summary: PullRequestSnapshot["checks"]["summary"],
): BadgeProps["variant"] {
  switch (summary) {
    case "passing":
      return "success";
    case "pending":
      return "warning";
    case "failing":
      return "error";
    case "none":
      return "secondary";
    default: {
      const exhaustive: never = summary;
      return exhaustive;
    }
  }
}
