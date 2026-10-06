import type {
  PullRequestAction,
  PullRequestDiff,
  PullRequestSnapshot,
} from "@getpie/contract/pull-request";
import { Response } from "@getpie/ui/ai-elements/response";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@getpie/ui/components/alert";
import { Button, buttonVariants } from "@getpie/ui/components/button";
import { Separator } from "@getpie/ui/components/separator";
import { Tabs, TabsList, TabsPanel, TabsTab } from "@getpie/ui/components/tabs";
import type { UseQueryResult } from "@tanstack/react-query";
import { ExternalLinkIcon, GitPullRequestIcon, RefreshCwIcon } from "lucide-react";

import { PullRequestActions } from "./pull-request-actions";
import { PullRequestChecks } from "./pull-request-checks";
import { PullRequestDiffPane } from "./pull-request-diff-pane";
import { PullRequestSummary } from "./pull-request-summary";

export function PullRequestInspect({
  actionPending = false,
  diff,
  onAction,
  onRefresh,
  postActionRefreshFailed = false,
  refreshing,
  snapshot,
}: {
  actionPending?: boolean;
  diff: UseQueryResult<PullRequestDiff>;
  onAction?: (action: PullRequestAction) => void;
  onRefresh: () => void;
  postActionRefreshFailed?: boolean;
  refreshing: boolean;
  snapshot: PullRequestSnapshot;
}) {
  return (
    <Tabs className="flex min-h-0 flex-1 flex-col gap-0 overflow-hidden" defaultValue="summary">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b px-3">
        <span className="relative me-1">
          <GitPullRequestIcon className="text-muted-foreground size-4" />
          <span className="bg-pull-request-open ring-background absolute -right-1 -bottom-0.5 size-2 rounded-full ring-2" />
        </span>
        <TabsList>
          <TabsTab value="summary">Summary</TabsTab>
          <TabsTab value="code">Code</TabsTab>
        </TabsList>
        <div className="ms-auto flex items-center gap-1.5">
          <Button
            aria-label="Refresh pull request"
            loading={refreshing}
            onClick={onRefresh}
            size="icon-xs"
            variant="ghost"
          >
            <RefreshCwIcon />
          </Button>
          <a
            aria-label="Open pull request on GitHub"
            className={buttonVariants({ size: "icon-xs", variant: "ghost" })}
            href={snapshot.url}
            rel="noreferrer"
            target="_blank"
          >
            <ExternalLinkIcon />
          </a>
          {onAction === undefined ? null : (
            <PullRequestActions disabled={actionPending} onAction={onAction} snapshot={snapshot} />
          )}
        </div>
      </div>

      <TabsPanel className="min-h-0 flex-1 overflow-y-auto p-5" value="summary">
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-5">
          {postActionRefreshFailed ? (
            <Alert variant="warning">
              <AlertTitle>Action applied; status refresh failed</AlertTitle>
              <AlertDescription>
                The write succeeded on GitHub, but this snapshot is stale.
              </AlertDescription>
              <AlertAction>
                <Button onClick={onRefresh} size="xs" variant="outline">
                  Retry
                </Button>
              </AlertAction>
            </Alert>
          ) : null}

          <PullRequestSummary snapshot={snapshot} />

          <Separator />
          <section aria-labelledby="pull-request-description" className="flex flex-col gap-4">
            <h2 id="pull-request-description" className="text-base font-medium">
              Description
            </h2>
            {snapshot.body.length > 0 ? (
              <Response animated={false}>{snapshot.body}</Response>
            ) : (
              <p className="text-muted-foreground text-sm">No description provided.</p>
            )}
          </section>

          <Separator />
          <PullRequestChecks snapshot={snapshot} />
        </div>
      </TabsPanel>

      <TabsPanel className="flex min-h-0 flex-1 flex-col overflow-hidden" value="code">
        <PullRequestDiffPane baseBranch={snapshot.baseBranch} diff={diff} key={snapshot.head.sha} />
      </TabsPanel>
    </Tabs>
  );
}
