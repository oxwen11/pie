import type { SessionRef } from "@getpie/contract";
import {
  projectSessionPullRequests,
  pullRequestKey,
  type PullRequestRef,
  type PullRequestSessionStatus,
  type PullRequestAction,
  type PullRequestActionInput,
} from "@getpie/contract/pull-request";
import { Button } from "@getpie/ui/components/button";
import { Spinner } from "@getpie/ui/components/spinner";
import { ORPCError } from "@orpc/client";
import { skipToken, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { GitPullRequestIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import type { PanelHandle } from "@/components/layout/content-panel/model/panel";
import { definePanel } from "@/components/layout/content-panel/react/view";
import { usePullRequestPanelDemand } from "@/components/layout/pull-request-demand-provider";
import { useEnvironmentOrpc } from "@/lib/environment-orpc";
import { sessionRefKey } from "@/lib/session-ref";

import { ConfirmPullRequestAction } from "./confirm-pull-request-action";
import { pullRequestActionError } from "./pull-request-action-error";
import { PullRequestInspect } from "./pull-request-inspect";
import { PullRequestLinks } from "./pull-request-links";
import { PullRequestPanelState } from "./pull-request-panel-state";
import { pullRequestActionInput } from "./pull-request-presentation";
import { PullRequestStackActions } from "./pull-request-stack-actions";

export const pullRequestPanel = definePanel({
  type: "pull-request",
  label: "Pull requests",
  view: {
    icon: GitPullRequestIcon,
    render: (instance) => (
      <PullRequestPanelView key={sessionRefKey(instance.sessionRef)} instance={instance} />
    ),
  },
});

const selectStatus = (statuses: readonly PullRequestSessionStatus[]) => statuses[0];

function PullRequestPanelView({ instance }: { instance: PanelHandle<void> }) {
  const sessionRef = instance.sessionRef.ref;
  const visible = usePullRequestPanelDemand(sessionRef);
  const orpc = useEnvironmentOrpc();
  const queryClient = useQueryClient();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const options = orpc.pullRequest.statuses.queryOptions({
    input: { refs: [sessionRef] },
  });
  const statuses = useQuery({ ...options, enabled: visible, select: selectStatus });
  const projection = projectSessionPullRequests(statuses.data?.links ?? []);
  const selected =
    projection.groups
      .flatMap((group) => group.links)
      .find((link) => pullRequestKey(link.ref) === selectedKey) ?? projection.representative;
  const refresh = useMutation({
    mutationFn: () => orpc.pullRequest.refresh.call({ ref: sessionRef }),
    onSuccess: (status) => {
      queryClient.setQueryData(options.queryKey, [status]);
      void queryClient.invalidateQueries({ queryKey: orpc.pullRequest.statuses.key() });
      void queryClient.invalidateQueries({ queryKey: orpc.pullRequest.detail.key() });
    },
    retry: false,
  });
  const exclude = useMutation({
    mutationFn: (pullRequest: PullRequestRef) =>
      orpc.pullRequest.exclude.call({ ref: sessionRef, pullRequest }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: orpc.pullRequest.statuses.key() });
    },
    retry: false,
  });
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
        <h2 className="text-sm font-medium">Linked pull requests</h2>
        <Button
          size="xs"
          variant="outline"
          loading={refresh.isPending}
          onClick={() => refresh.mutate()}
        >
          Refresh
        </Button>
      </div>
      {statuses.isError || statuses.data?.state === "error" || refresh.isError ? (
        <div role="alert" className="text-muted-foreground px-3 py-2 text-xs">
          <p>
            {refresh.error?.message ??
              statuses.error?.message ??
              statuses.data?.error ??
              "Unable to update pull requests."}{" "}
            Saved identities and last verified states are retained.
          </p>
          <Button
            size="xs"
            variant="outline"
            loading={refresh.isPending}
            onClick={() => refresh.mutate()}
          >
            Retry
          </Button>
        </div>
      ) : null}
      {exclude.isError ? (
        <p role="alert" className="text-destructive p-3 text-xs">
          Unable to cancel association: {exclude.error.message}. Try Unlink again.
        </p>
      ) : null}
      {statuses.data?.state === "pending" ? (
        <p role="status" className="text-muted-foreground px-3 py-2 text-xs">
          Updating linked pull requests…
        </p>
      ) : null}
      {selected ? (
        <>
          <PullRequestLinks
            projection={projection}
            selected={pullRequestKey(selected.ref)}
            onSelect={setSelectedKey}
            onExclude={(ref) => exclude.mutate(ref)}
            excluding={exclude.isPending}
          />
          <LinkedPullRequestDetail
            key={pullRequestKey(selected.ref)}
            sessionRef={sessionRef}
            pullRequestRef={selected.ref}
            visible={visible}
            nativeStack={selected.stack !== null}
          />
        </>
      ) : (
        <PullRequestPanelState
          title={statuses.isPending ? "Loading linked pull requests" : "No linked pull requests"}
        >
          <p>
            {statuses.isPending
              ? "Reading saved associations…"
              : "Pull requests registered by the agent will appear here. An unknown branch does not mean there are no pull requests."}
          </p>
        </PullRequestPanelState>
      )}
    </div>
  );
}

function LinkedPullRequestDetail({
  sessionRef,
  pullRequestRef,
  visible,
  nativeStack,
}: {
  sessionRef: SessionRef;
  pullRequestRef: PullRequestRef;
  visible: boolean;
  nativeStack: boolean;
}) {
  const orpc = useEnvironmentOrpc();
  const queryClient = useQueryClient();
  const options = orpc.pullRequest.detail.queryOptions({
    input: { ref: sessionRef, pullRequest: pullRequestRef },
  });
  const pullRequest = useQuery({ ...options, enabled: visible });
  const diff = useQuery(
    orpc.pullRequest.diff.queryOptions({
      input: visible ? { pullRequest: pullRequestRef } : skipToken,
    }),
  );
  const [intent, setIntent] = useState<PullRequestActionInput | null>(null);
  const [postActionRefreshFailed, setPostActionRefreshFailed] = useState(false);
  const refresh = (): void => {
    void pullRequest.refetch().then((result) => {
      if (!result.isError) setPostActionRefreshFailed(false);
      return undefined;
    });
    void diff.refetch();
  };
  const action = useMutation({
    mutationFn: (input: PullRequestActionInput) => orpc.pullRequest.runAction.call(input),
    onMutate: () => setPostActionRefreshFailed(false),
    onSuccess: () => {
      setIntent(null);
      toast.success("Pull request action applied");
      void queryClient.invalidateQueries({ queryKey: options.queryKey, refetchType: "none" });
      void pullRequest.refetch().then(
        (result) => setPostActionRefreshFailed(result.isError),
        () => setPostActionRefreshFailed(true),
      );
      void diff.refetch();
    },
    onError: (error) => {
      setIntent(null);
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
      <PullRequestPanelState title="Pull request unavailable">
        <p>
          The saved identity could not be read from GitHub. Its association is retained; retry when
          access is restored.
        </p>
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
    <div className="flex min-h-0 flex-1 flex-col">
      <PullRequestInspect
        actionPending={action.isPending}
        diff={diff}
        onAction={beginAction}
        onRefresh={refresh}
        postActionRefreshFailed={postActionRefreshFailed}
        refreshing={pullRequest.isFetching || diff.isFetching}
        snapshot={snapshot}
      />
      <div className="shrink-0 border-t px-4 py-3">
        {nativeStack ? (
          <PullRequestStackActions sessionRef={sessionRef} pullRequest={pullRequestRef} />
        ) : (
          <p className="text-muted-foreground text-xs">
            Stack actions are available only for a verified native Stack.
          </p>
        )}
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
