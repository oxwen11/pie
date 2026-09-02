import type { PullRequestAction, PullRequestActionInput } from "@getpie/contract/pull-request";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@getpie/ui/components/alert";
import { Button } from "@getpie/ui/components/button";
import { Separator } from "@getpie/ui/components/separator";
import { Spinner } from "@getpie/ui/components/spinner";
import { ORPCError } from "@orpc/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouteContext } from "@tanstack/react-router";
import { ExternalLinkIcon, GitPullRequestIcon, RefreshCwIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import type { PanelHandle } from "@/components/layout/content-panel/model/panel";
import { definePanel } from "@/components/layout/content-panel/react/view";

import { ConfirmPullRequestAction } from "./confirm-pull-request-action";
import { PullRequestActions } from "./pull-request-actions";
import { PullRequestChecks } from "./pull-request-checks";
import { PullRequestPanelState } from "./pull-request-panel-state";
import { pullRequestActionInput } from "./pull-request-presentation";
import { PullRequestSummary } from "./pull-request-summary";

export const pullRequestPanel = definePanel({
  type: "pull-request",
  label: "Pull request",
  view: {
    icon: GitPullRequestIcon,
    render: (instance) => <PullRequestPanelView instance={instance} />,
  },
});

function PullRequestPanelView({ instance }: { instance: PanelHandle<void> }) {
  const { orpcQueryUtils } = useRouteContext({ from: "__root__" });
  const queryClient = useQueryClient();
  const options = orpcQueryUtils.pullRequest.current.queryOptions({
    input: { ref: instance.sessionRef },
  });
  const pullRequest = useQuery(options);
  const [intent, setIntent] = useState<PullRequestActionInput | null>(null);
  const [postActionRefreshFailed, setPostActionRefreshFailed] = useState(false);
  const refresh = (): void => {
    void pullRequest.refetch().then((result) => {
      if (!result.isError) setPostActionRefreshFailed(false);
    });
  };
  const action = useMutation({
    mutationFn: (input: PullRequestActionInput) => orpcQueryUtils.pullRequest.runAction.call(input),
    onMutate: () => setPostActionRefreshFailed(false),
    onSuccess: () => {
      setIntent(null);
      toast.success("Pull request action applied");
      void queryClient.invalidateQueries({ queryKey: options.queryKey, refetchType: "none" });
      void pullRequest.refetch().then(
        (result) => setPostActionRefreshFailed(result.isError),
        () => setPostActionRefreshFailed(true),
      );
    },
    onError: (error) => {
      toast.error(pullRequestActionError(error));
      if (error instanceof ORPCError && error.code === "STALE_CONTEXT") refresh();
    },
  });

  if (pullRequest.isPending && pullRequest.data === undefined) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <Spinner className="text-muted-foreground size-4" />
      </div>
    );
  }

  if (pullRequest.isError && pullRequest.data === undefined) {
    return (
      <PullRequestPanelState title={pullRequestErrorTitle(pullRequest.error)}>
        <p>{pullRequestErrorMessage(pullRequest.error)}</p>
        <Button onClick={refresh} size="sm" variant="outline">
          Retry
        </Button>
      </PullRequestPanelState>
    );
  }

  const snapshot = pullRequest.data;
  if (snapshot === null || snapshot === undefined) {
    return (
      <PullRequestPanelState title="No pull request">
        <p>The current branch does not have an open or closed pull request on GitHub.</p>
        <Button onClick={refresh} size="sm" variant="outline">
          Refresh
        </Button>
      </PullRequestPanelState>
    );
  }

  const beginAction = (next: PullRequestAction): void => {
    setIntent(pullRequestActionInput(instance.sessionRef, snapshot, next));
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b px-3">
        <GitPullRequestIcon className="text-muted-foreground size-4" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium" title={snapshot.title}>
          {snapshot.title}
        </span>
        <Button
          aria-label="Refresh pull request"
          loading={pullRequest.isFetching}
          onClick={refresh}
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

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
          {postActionRefreshFailed ? (
            <Alert variant="warning">
              <AlertTitle>Action applied; status refresh failed</AlertTitle>
              <AlertDescription>
                The write succeeded on GitHub, but this snapshot is stale.
              </AlertDescription>
              <AlertAction>
                <Button onClick={refresh} size="xs" variant="outline">
                  Retry
                </Button>
              </AlertAction>
            </Alert>
          ) : null}

          <PullRequestSummary snapshot={snapshot} />
          <Separator />
          <PullRequestChecks snapshot={snapshot} />
          <PullRequestActions
            disabled={action.isPending}
            onAction={beginAction}
            snapshot={snapshot}
          />
        </div>
      </div>

      {intent !== null ? (
        <ConfirmPullRequestAction
          input={intent}
          loading={action.isPending}
          onCancel={() => setIntent(null)}
          onConfirm={() => action.mutate(intent)}
        />
      ) : null}
    </div>
  );
}

function pullRequestErrorTitle(error: Error): string {
  if (!(error instanceof ORPCError)) return "Unable to load pull request";
  switch (error.code) {
    case "MISSING_GH":
      return "GitHub CLI not installed";
    case "UNAUTHENTICATED":
      return "GitHub CLI not authenticated";
    case "UNSUPPORTED_CONTEXT":
      return "Unsupported Git workspace";
    default:
      return "Unable to load pull request";
  }
}

function pullRequestErrorMessage(error: Error): string {
  if (!(error instanceof ORPCError)) return error.message;
  switch (error.code) {
    case "MISSING_GH":
      return "Install gh, then reopen or refresh this panel.";
    case "UNAUTHENTICATED":
      return "Run gh auth login in a terminal, then retry.";
    case "RATE_LIMITED":
      return "GitHub rate limiting is active. Wait, then retry.";
    case "UNSUPPORTED_CONTEXT":
      return "Check out a branch with a GitHub remote and try again.";
    case "INVALID_RESPONSE":
      return "The installed gh version returned data pie could not understand.";
    default:
      return error.message;
  }
}

function pullRequestActionError(error: Error): string {
  if (!(error instanceof ORPCError)) return `Pull request action failed: ${error.message}`;
  switch (error.code) {
    case "STALE_CONTEXT":
      return "The pull request changed. Refresh and confirm the action again.";
    case "UNSUPPORTED_ACTION":
      return "Update GitHub CLI before performing this action safely.";
    case "OUTCOME_UNKNOWN":
      return "Could not confirm whether GitHub applied the action. Check GitHub before retrying.";
    case "HOST_UNAVAILABLE":
      return "GitHub could not be reached before the action started. Try again later.";
    case "INVALID_RESPONSE":
      return "GitHub returned data pie could not safely use. Refresh before retrying.";
    case "UNAUTHENTICATED":
      return "Run gh auth login, then try again.";
    case "RATE_LIMITED":
      return "GitHub rate limiting is active. Wait, then retry.";
    default:
      return "GitHub rejected the pull request action.";
  }
}
