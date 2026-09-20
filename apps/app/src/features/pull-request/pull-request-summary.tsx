import type { PullRequestSnapshot } from "@getpie/contract/pull-request";
import {
  CircleCheckIcon,
  GitBranchIcon,
  GitPullRequestIcon,
  MessagesSquareIcon,
} from "lucide-react";

import {
  checksSummaryLabel,
  formatPullRequestAge,
  pullRequestLifecycleLabel,
  pullRequestReviewLabel,
} from "./pull-request-presentation";

const checksSummaryClasses = {
  failing: "text-destructive",
  none: "text-muted-foreground",
  passing: "text-pull-request-open",
  pending: "text-warning",
} satisfies Record<PullRequestSnapshot["checks"]["summary"], string>;

export function PullRequestSummary({ snapshot }: { snapshot: PullRequestSnapshot }) {
  const age = formatPullRequestAge(snapshot.updatedAt);
  return (
    <section aria-labelledby="pull-request-summary" className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1
          id="pull-request-summary"
          className="text-2xl leading-tight font-semibold tracking-tight"
        >
          {snapshot.title}
        </h1>
        <p className="text-muted-foreground text-sm">
          {snapshot.ref.owner}
          {age.length > 0 ? ` · ${age}` : ""}
        </p>
      </div>

      <dl className="grid grid-cols-[1.25rem_auto_minmax(0,1fr)] items-center gap-x-2 gap-y-3 text-sm">
        <GitBranchIcon className="text-muted-foreground size-4" />
        <dt className="text-muted-foreground">Branch</dt>
        <dd className="min-w-0 truncate">
          <span className="font-mono text-xs">{snapshot.head.branch}</span>
          <span className="text-muted-foreground px-2">→</span>
          <span className="font-mono text-xs">{snapshot.baseBranch}</span>
        </dd>

        <MessagesSquareIcon className="text-muted-foreground size-4" />
        <dt className="text-muted-foreground">Review</dt>
        <dd>{pullRequestReviewLabel(snapshot)}</dd>

        <CircleCheckIcon className="text-pull-request-open size-4" />
        <dt className="text-muted-foreground">Checks</dt>
        <dd className={checksSummaryClasses[snapshot.checks.summary]}>
          {checksSummaryLabel(snapshot.checks.summary)}
        </dd>

        <GitPullRequestIcon className="text-muted-foreground size-4" />
        <dt className="text-muted-foreground">Status</dt>
        <dd>{pullRequestLifecycleLabel(snapshot)}</dd>
      </dl>
    </section>
  );
}
