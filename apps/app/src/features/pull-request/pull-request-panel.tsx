import type { PullRequestAction } from "@getpie/contract/pull-request";
import { Button } from "@getpie/ui/components/button";
import { Spinner } from "@getpie/ui/components/spinner";
import { ORPCError } from "@orpc/client";
import { skipToken, useQuery, useQueryClient } from "@tanstack/react-query";
import { GitPullRequestIcon } from "lucide-react";

import type { PanelHandle } from "@/components/layout/content-panel/model/panel";
import { definePanel } from "@/components/layout/content-panel/react/view";
import { useEnvironmentOrpc } from "@/lib/environment-orpc";

import { ConfirmPullRequestAction } from "./confirm-pull-request-action";
import { PullRequestInspect } from "./pull-request-inspect";
import { PullRequestPanelState } from "./pull-request-panel-state";
import { pullRequestActionInput } from "./pull-request-presentation";
import { usePullRequestAction } from "./use-pull-request-action";

export const pullRequestPanel = definePanel({
  type: "pull-request",
  label: "Pull request",
  view: {
    icon: GitPullRequestIcon,
    render: (instance) => <PullRequestPanelView instance={instance} />,
  },
});

function PullRequestPanelView({ instance }: { instance: PanelHandle<void> }) {
  const orpcQueryUtils = useEnvironmentOrpc();
  const queryClient = useQueryClient();
  const sessionRef = instance.sessionRef.ref;
  const options = orpcQueryUtils.pullRequest.current.queryOptions({
    input: { ref: sessionRef },
  });
  const pullRequest = useQuery(options);
  const snapshot = pullRequest.data;
  const diff = useQuery(
    orpcQueryUtils.pullRequest.diff.queryOptions({
      input: snapshot === null || snapshot === undefined ? skipToken : { ref: sessionRef },
    }),
  );
  const { intent, pending, postActionRefreshFailed, refresh, run, setIntent } =
    usePullRequestAction({
      mutationFn: (input) => orpcQueryUtils.pullRequest.runAction.call(input),
      mutationKey: orpcQueryUtils.pullRequest.runAction.key(),
      onApplied: () => {
        void queryClient.invalidateQueries({ queryKey: options.queryKey, refetchType: "none" });
      },
      refetchDetail: () => pullRequest.refetch(),
      refetchDiff: () => diff.refetch(),
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
    setIntent(pullRequestActionInput(sessionRef, snapshot, next));
  };

  return (
    <>
      <PullRequestInspect
        actionPending={pending}
        diff={diff}
        onAction={beginAction}
        onRefresh={refresh}
        postActionRefreshFailed={postActionRefreshFailed}
        refreshing={pullRequest.isFetching || diff.isFetching}
        snapshot={snapshot}
      />
      {intent !== null ? (
        <ConfirmPullRequestAction
          input={intent}
          loading={pending}
          onCancel={() => setIntent(null)}
          onConfirm={() => run(intent)}
        />
      ) : null}
    </>
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
