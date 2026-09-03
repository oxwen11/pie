import type {
  PullRequestAction,
  PullRequestDiff,
  PullRequestSnapshot,
} from "@getpie/contract/pull-request";
import { Response } from "@getpie/ui/ai-elements/response";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@getpie/ui/components/alert";
import { Button } from "@getpie/ui/components/button";
import { Separator } from "@getpie/ui/components/separator";
import { Tabs, TabsList, TabsPanel, TabsTab } from "@getpie/ui/components/tabs";
import type { UseQueryResult } from "@tanstack/react-query";
import { ExternalLinkIcon, GitPullRequestIcon, RefreshCwIcon } from "lucide-react";

import { PullRequestActions } from "./pull-request-actions";
import { PullRequestChecks } from "./pull-request-checks";
import { PullRequestDiffPane } from "./pull-request-diff-pane";
import { countDiffFiles } from "./pull-request-presentation";
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
  const fileCount = diff.data === undefined ? undefined : countDiffFiles(diff.data.patch);
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b px-3">
        <GitPullRequestIcon className="text-muted-foreground size-4" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium" title={snapshot.title}>
          {snapshot.title}
        </span>
        <Button
          aria-label="Refresh pull request"
          loading={refreshing}
          onClick={onRefresh}
          size="icon-xs"
          variant="ghost"
        >
          <RefreshCwIcon />
        </Button>
        <Button
          render={
            <a
              aria-label="Open pull request on GitHub"
              href={snapshot.url}
              rel="noreferrer"
              target="_blank"
            />
          }
          size="xs"
          variant="outline"
        >
          Open
          <ExternalLinkIcon />
        </Button>
      </div>

      <Tabs className="flex min-h-0 flex-1 flex-col gap-0" defaultValue="overview">
        <div className="flex h-9 shrink-0 items-center border-b px-3">
          <TabsList variant="underline">
            <TabsTab value="overview">Overview</TabsTab>
            <TabsTab value="files">
              Files
              {fileCount === undefined ? null : (
                <span className="text-muted-foreground">{fileCount}</span>
              )}
            </TabsTab>
          </TabsList>
        </div>

        <TabsPanel className="min-h-0 flex-1 overflow-y-auto p-4" value="overview">
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
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
            {snapshot.body.length > 0 ? (
              <>
                <Separator />
                <Response animated={false}>{snapshot.body}</Response>
              </>
            ) : null}
            <Separator />
            <PullRequestChecks snapshot={snapshot} />
            {onAction === undefined ? null : (
              <PullRequestActions
                disabled={actionPending}
                onAction={onAction}
                snapshot={snapshot}
              />
            )}
          </div>
        </TabsPanel>

        <TabsPanel className="flex min-h-0 flex-1 flex-col overflow-hidden" value="files">
          <PullRequestDiffPane
            baseBranch={snapshot.baseBranch}
            diff={diff}
            key={snapshot.head.sha}
          />
        </TabsPanel>
      </Tabs>
    </div>
  );
}
