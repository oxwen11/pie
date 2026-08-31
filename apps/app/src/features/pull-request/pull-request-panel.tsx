import type {
  PullRequestAction,
  PullRequestActionInput,
  PullRequestCheck,
  PullRequestCheckStatus,
  PullRequestMergeMethod,
  PullRequestSnapshot,
} from "@getpie/contract/pull-request";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@getpie/ui/components/alert";
import {
  AlertDialog,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "@getpie/ui/components/alert-dialog";
import { Badge, type BadgeProps } from "@getpie/ui/components/badge";
import { Button } from "@getpie/ui/components/button";
import { Separator } from "@getpie/ui/components/separator";
import { Spinner } from "@getpie/ui/components/spinner";
import { ORPCError } from "@orpc/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouteContext } from "@tanstack/react-router";
import {
  CheckCircle2Icon,
  CircleMinusIcon,
  Clock3Icon,
  ExternalLinkIcon,
  GitMergeIcon,
  GitPullRequestIcon,
  RefreshCwIcon,
  XCircleIcon,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";

import type { PanelHandle } from "@/components/layout/content-panel/model/panel";
import { definePanel } from "@/components/layout/content-panel/react/view";

import {
  pullRequestActionInput,
  pullRequestLifecycleLabel,
  pullRequestReviewLabel,
} from "./pull-request-presentation";

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
      <PanelState title={pullRequestErrorTitle(pullRequest.error)}>
        <p>{pullRequestErrorMessage(pullRequest.error)}</p>
        <Button onClick={refresh} size="sm" variant="outline">
          Retry
        </Button>
      </PanelState>
    );
  }

  const snapshot = pullRequest.data;
  if (snapshot === null || snapshot === undefined) {
    return (
      <PanelState title="No pull request">
        <p>The current branch does not have an open or closed pull request on GitHub.</p>
        <Button onClick={refresh} size="sm" variant="outline">
          Refresh
        </Button>
      </PanelState>
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

function PullRequestSummary({ snapshot }: { snapshot: PullRequestSnapshot }) {
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

function PullRequestChecks({ snapshot }: { snapshot: PullRequestSnapshot }) {
  return (
    <section aria-labelledby="pull-request-checks" className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <h2 id="pull-request-checks" className="text-sm font-semibold">
          Checks
        </h2>
        <span className="text-muted-foreground text-xs">{snapshot.checks.items.length}</span>
      </div>
      {snapshot.checks.items.length === 0 ? (
        <p className="text-muted-foreground text-sm">No checks reported.</p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {snapshot.checks.items.map((check, index) => (
            <CheckRow check={check} key={`${check.name}:${index}`} />
          ))}
        </ul>
      )}
    </section>
  );
}

function CheckRow({ check }: { check: PullRequestCheck }) {
  const contents = (
    <>
      <CheckIcon status={check.status} />
      <span className="min-w-0 flex-1 truncate">{check.name}</span>
      <span className="text-muted-foreground text-xs">{checkStatusLabel(check.status)}</span>
      {check.url === null ? null : <ExternalLinkIcon className="size-3.5" />}
    </>
  );
  return (
    <li className="text-sm">
      {check.url === null ? (
        <div className="flex min-h-10 items-center gap-2 px-3">{contents}</div>
      ) : (
        <a
          className="hover:bg-accent flex min-h-10 items-center gap-2 px-3 outline-none focus-visible:ring-2 focus-visible:ring-inset"
          href={check.url}
          rel="noreferrer"
          target="_blank"
        >
          {contents}
        </a>
      )}
    </li>
  );
}

function PullRequestActions({
  disabled,
  onAction,
  snapshot,
}: {
  disabled: boolean;
  onAction: (action: PullRequestAction) => void;
  snapshot: PullRequestSnapshot;
}) {
  if (snapshot.offeredActions.length === 0) return null;
  return (
    <section aria-labelledby="pull-request-actions" className="flex flex-col gap-2">
      <h2 id="pull-request-actions" className="text-sm font-semibold">
        Actions
      </h2>
      <div className="flex flex-wrap gap-2">
        {snapshot.offeredActions.flatMap((offered) => {
          if (offered.type === "disable-auto-merge") {
            return [
              <Button
                disabled={disabled}
                key={offered.type}
                onClick={() => onAction({ type: "disable-auto-merge" })}
                size="sm"
                variant="outline"
              >
                Disable auto-merge
              </Button>,
            ];
          }
          return offered.methods.map((method) => (
            <Button
              disabled={disabled}
              key={`${offered.type}:${method}`}
              onClick={() => onAction({ type: offered.type, method })}
              size="sm"
              variant={offered.type === "merge" ? "default" : "outline"}
            >
              <GitMergeIcon />
              {offered.type === "merge"
                ? mergeMethodActionLabel(method)
                : `Auto · ${mergeMethodLabel(method)}`}
            </Button>
          ));
        })}
      </div>
    </section>
  );
}

function ConfirmPullRequestAction({
  input,
  loading,
  onCancel,
  onConfirm,
}: {
  input: PullRequestActionInput;
  loading: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const description = actionConfirmationDescription(input);
  return (
    <AlertDialog open onOpenChange={(open) => !open && !loading && onCancel()}>
      <AlertDialogPopup>
        <AlertDialogHeader>
          <AlertDialogTitle>{actionConfirmationTitle(input.action)}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <Button disabled={loading} onClick={onCancel} variant="outline">
            Cancel
          </Button>
          <Button loading={loading} onClick={onConfirm}>
            Confirm
          </Button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
}

function PanelState({ children, title }: { children: ReactNode; title: string }) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-6">
      <div className="text-muted-foreground flex max-w-sm flex-col items-center gap-3 text-center text-sm">
        <GitPullRequestIcon className="size-8" />
        <h2 className="text-foreground text-base font-semibold">{title}</h2>
        {children}
      </div>
    </div>
  );
}

function CheckIcon({ status }: { status: PullRequestCheckStatus }) {
  switch (status) {
    case "success":
      return <CheckCircle2Icon className="text-success size-4" />;
    case "failure":
    case "cancelled":
      return <XCircleIcon className="text-destructive size-4" />;
    case "pending":
      return <Clock3Icon className="text-warning size-4" />;
    case "skipped":
    case "neutral":
      return <CircleMinusIcon className="text-muted-foreground size-4" />;
  }
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
  }
}

function checksSummaryLabel(summary: PullRequestSnapshot["checks"]["summary"]): string {
  switch (summary) {
    case "passing":
      return "Checks passing";
    case "pending":
      return "Checks pending";
    case "failing":
      return "Checks failing";
    case "none":
      return "No checks";
  }
}

function checkStatusLabel(status: PullRequestCheckStatus): string {
  switch (status) {
    case "success":
      return "Passed";
    case "failure":
      return "Failed";
    case "cancelled":
      return "Cancelled";
    case "pending":
      return "Pending";
    case "skipped":
      return "Skipped";
    case "neutral":
      return "Neutral";
  }
}

function mergeMethodLabel(method: PullRequestMergeMethod): string {
  switch (method) {
    case "merge":
      return "Merge commit";
    case "squash":
      return "Squash";
    case "rebase":
      return "Rebase";
  }
}

function mergeMethodActionLabel(method: PullRequestMergeMethod): string {
  switch (method) {
    case "merge":
      return "Merge";
    case "squash":
      return "Squash and merge";
    case "rebase":
      return "Rebase and merge";
  }
}

function actionConfirmationTitle(action: PullRequestAction): string {
  switch (action.type) {
    case "merge":
      return mergeMethodActionLabel(action.method);
    case "enable-auto-merge":
      return `Enable auto-merge · ${mergeMethodLabel(action.method)}`;
    case "disable-auto-merge":
      return "Disable auto-merge";
  }
}

function actionConfirmationDescription(input: PullRequestActionInput): string {
  const identity = `${input.expected.pullRequest.owner}/${input.expected.pullRequest.repository}#${input.expected.pullRequest.number}`;
  if ("headSha" in input.expected) {
    return `${identity} at ${input.expected.headSha.slice(0, 12)}. GitHub will reject the action if the head changed.`;
  }
  return `${identity}. GitHub remains authoritative for repository policy.`;
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
