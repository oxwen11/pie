import type {
  PullRequestAction,
  PullRequestActionInput,
  PullRequestDiff,
  PullRequestListItem,
  PullRequestRef,
  PullRequestSnapshot,
} from "@getpie/contract/pull-request";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@getpie/ui/components/empty";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@getpie/ui/components/input-group";
import { Spinner } from "@getpie/ui/components/spinner";
import { cn } from "@getpie/ui/lib/utils";
import { ORPCError } from "@orpc/client";
import { skipToken, useMutation, useQuery, type UseQueryResult } from "@tanstack/react-query";
import { useRouteContext } from "@tanstack/react-router";
import { GitPullRequestIcon, SearchIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import Loader from "@/components/loader";

import { ConfirmPullRequestAction } from "./confirm-pull-request-action";
import { pullRequestActionError } from "./pull-request-action-error";
import { PullRequestInspect } from "./pull-request-inspect";
import { PullRequestPanelState } from "./pull-request-panel-state";
import {
  filterPullRequestItems,
  pullRequestActionInput,
  pullRequestRepositoryLabel,
  selectedPullRequest,
  samePullRequestRef,
} from "./pull-request-presentation";

export function PullRequestPage() {
  const { orpcQueryUtils } = useRouteContext({ from: "__root__" });
  const [query, setQuery] = useState("");
  const [selectedRef, setSelectedRef] = useState<PullRequestRef | null>(null);
  const list = useQuery(orpcQueryUtils.pullRequest.list.queryOptions());
  const items = list.data ?? [];
  const visible = filterPullRequestItems(items, query);
  const selected = selectedPullRequest(items, visible, selectedRef);
  const detail = useQuery(
    orpcQueryUtils.pullRequest.detail.queryOptions({
      input: selected === undefined ? skipToken : { pullRequest: selected.ref },
    }),
  );
  const diff = useQuery(
    orpcQueryUtils.pullRequest.diff.queryOptions({
      input: selected === undefined ? skipToken : { pullRequest: selected.ref },
    }),
  );
  const [intent, setIntent] = useState<PullRequestActionInput | null>(null);
  const [postActionRefreshFailed, setPostActionRefreshFailed] = useState(false);
  const refresh = (): void => {
    void detail.refetch().then((result) => {
      if (!result.isError) setPostActionRefreshFailed(false);
    });
    void diff.refetch();
  };
  const action = useMutation({
    mutationFn: (input: PullRequestActionInput) => orpcQueryUtils.pullRequest.runAction.call(input),
    onMutate: () => setPostActionRefreshFailed(false),
    onSuccess: () => {
      setIntent(null);
      toast.success("Pull request action applied");
      void list.refetch();
      void detail.refetch().then(
        (result) => setPostActionRefreshFailed(result.isError),
        () => setPostActionRefreshFailed(true),
      );
      void diff.refetch();
    },
    onError: (error) => {
      toast.error(pullRequestActionError(error));
      if (error instanceof ORPCError && error.code === "STALE_CONTEXT") refresh();
    },
  });

  if (list.isPending && list.data === undefined) {
    return <Loader />;
  }

  if (list.isError) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>Could not load pull requests</EmptyTitle>
          <EmptyDescription>{list.error.message}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  if (items.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <GitPullRequestIcon aria-hidden="true" />
          </EmptyMedia>
          <EmptyTitle>No open pull requests</EmptyTitle>
          <EmptyDescription>
            Open pull requests authored by the GitHub account signed into gh will show up here.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <>
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="border-border flex w-[22rem] shrink-0 flex-col border-e">
          <div className="px-3 py-3">
            <InputGroup>
              <InputGroupAddon>
                <SearchIcon />
              </InputGroupAddon>
              <InputGroupInput
                aria-label="Search pull requests"
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search pull requests"
                value={query}
              />
            </InputGroup>
          </div>
          {visible.length === 0 ? (
            <p className="text-muted-foreground px-4 py-6 text-sm">No matching pull requests.</p>
          ) : (
            <ul className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2 pb-3">
              {visible.map((item) => (
                <PullRequestListRow
                  item={item}
                  key={`${item.ref.host}/${item.ref.owner}/${item.ref.repository}#${item.ref.number}`}
                  selected={selected !== undefined && samePullRequestRef(item.ref, selected.ref)}
                  onSelect={() => setSelectedRef(item.ref)}
                />
              ))}
            </ul>
          )}
        </div>
        <PullRequestPageDetail
          actionPending={action.isPending}
          diff={diff}
          error={detail.error}
          onAction={(next) => {
            if (detail.data !== null && detail.data !== undefined) {
              setIntent(pullRequestActionInput(detail.data.ref, detail.data, next));
            }
          }}
          onRefresh={refresh}
          pending={detail.isPending && detail.data === undefined}
          postActionRefreshFailed={postActionRefreshFailed}
          refreshing={detail.isFetching || diff.isFetching}
          snapshot={detail.data ?? undefined}
        />
      </div>
      {intent !== null ? (
        <ConfirmPullRequestAction
          input={intent}
          loading={action.isPending}
          onCancel={() => setIntent(null)}
          onConfirm={() => action.mutate(intent)}
        />
      ) : null}
    </>
  );
}

function PullRequestListRow({
  item,
  onSelect,
  selected,
}: {
  item: PullRequestListItem;
  onSelect: () => void;
  selected: boolean;
}) {
  return (
    <li>
      <button
        className={cn(
          "hover:bg-accent flex min-h-11 w-full flex-col gap-1 rounded-lg px-3 py-2.5 text-left",
          selected && "bg-accent",
        )}
        data-state={selected ? "active" : "inactive"}
        onClick={onSelect}
        type="button"
      >
        <span className="line-clamp-2 text-sm font-medium">{item.title}</span>
        <span className="flex items-baseline justify-between gap-3">
          <span className="text-muted-foreground min-w-0 truncate text-xs">
            {pullRequestRepositoryLabel(item.ref)}
            {item.headBranch.length > 0 ? ` ${item.headBranch}` : ""}
          </span>
          <span className="font-mono text-xs tabular-nums">
            <span className="text-success">+{item.additions}</span>
            <span className="text-destructive">-{item.deletions}</span>
          </span>
        </span>
      </button>
    </li>
  );
}

function PullRequestPageDetail({
  actionPending,
  diff,
  error,
  onAction,
  onRefresh,
  pending,
  postActionRefreshFailed,
  refreshing,
  snapshot,
}: {
  actionPending: boolean;
  diff: UseQueryResult<PullRequestDiff>;
  error: Error | null;
  onAction: (action: PullRequestAction) => void;
  onRefresh: () => void;
  pending: boolean;
  postActionRefreshFailed: boolean;
  refreshing: boolean;
  snapshot: PullRequestSnapshot | null | undefined;
}) {
  if (pending) {
    return (
      <div className="flex min-w-0 flex-1 items-center justify-center">
        <Spinner className="text-muted-foreground size-4" />
      </div>
    );
  }
  if (error !== null && snapshot === undefined) {
    return (
      <PullRequestPanelState title="Unable to load pull request">
        <p>{error.message}</p>
      </PullRequestPanelState>
    );
  }
  if (snapshot === null || snapshot === undefined) {
    return <div className="min-w-0 flex-1" />;
  }
  return (
    <PullRequestInspect
      actionPending={actionPending}
      diff={diff}
      onAction={onAction}
      onRefresh={onRefresh}
      postActionRefreshFailed={postActionRefreshFailed}
      refreshing={refreshing}
      snapshot={snapshot}
    />
  );
}
