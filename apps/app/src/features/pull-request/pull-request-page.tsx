import type {
  PullRequestAction,
  PullRequestActionInput,
  PullRequestDiff,
  PullRequestListItem,
  PullRequestRef,
  PullRequestSnapshot,
} from "@getpie/contract/pull-request";
import { Avatar, AvatarFallback } from "@getpie/ui/components/avatar";
import {
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
} from "@getpie/ui/components/collapsible";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@getpie/ui/components/input-group";
import { Skeleton } from "@getpie/ui/components/skeleton";
import { Spinner } from "@getpie/ui/components/spinner";
import { cn } from "@getpie/ui/lib/utils";
import { ORPCError } from "@orpc/client";
import { skipToken, useMutation, useQuery, type UseQueryResult } from "@tanstack/react-query";
import { ChevronRight, SearchIcon } from "lucide-react";
import { useState } from "react";
import { Group, Separator } from "react-resizable-panels";
import { toast } from "sonner";

import { ResizablePanel } from "@/components/layout/resizable-panel";
import { useLocalOrpc } from "@/lib/environment-orpc";

import { ConfirmPullRequestAction } from "./confirm-pull-request-action";
import { pullRequestActionError } from "./pull-request-action-error";
import { PullRequestInspect } from "./pull-request-inspect";
import { PullRequestPanelState } from "./pull-request-panel-state";
import {
  filterPullRequestItems,
  formatPullRequestAge,
  pullRequestActionInput,
  pullRequestRepositoryLabel,
  samePullRequestRef,
} from "./pull-request-presentation";

export function PullRequestPage() {
  const orpcQueryUtils = useLocalOrpc();
  const [selectedRef, setSelectedRef] = useState<PullRequestRef | null>(null);
  const list = useQuery(orpcQueryUtils.pullRequest.list.queryOptions());
  const items = list.data ?? [];
  const selected =
    selectedRef === null
      ? undefined
      : items.find((item) => samePullRequestRef(item.ref, selectedRef));
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
      return undefined;
    });
    void diff.refetch();
  };
  const action = useMutation({
    mutationKey: orpcQueryUtils.pullRequest.runAction.key(),
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

  const listLoading = list.isPending && list.data === undefined;
  const listError = list.isError ? list.error.message : null;

  return (
    <>
      <Group
        className="flex min-h-0 flex-1"
        orientation="horizontal"
        resizeTargetMinimumSize={{ coarse: 44, fine: 12 }}
      >
        <ResizablePanel
          className="flex min-w-0 flex-col"
          defaultSize="24rem"
          maxSize="50%"
          minSize="18rem"
        >
          <PullRequestListPane
            error={listError}
            items={items}
            loading={listLoading}
            onSelect={setSelectedRef}
            selected={selected}
          />
        </ResizablePanel>
        <Separator
          aria-label="Resize pull request list"
          className="after:bg-border hover:after:bg-foreground/30 data-[separator=active]:after:bg-primary relative w-1.5 bg-transparent after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 data-[separator=active]:after:w-0.5"
        />
        <ResizablePanel className="flex min-w-0 flex-col" minSize="18rem">
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
            pending={selected !== undefined && detail.isPending && detail.data === undefined}
            postActionRefreshFailed={postActionRefreshFailed}
            refreshing={detail.isFetching || diff.isFetching}
            selected={selected !== undefined}
            snapshot={detail.data ?? undefined}
          />
        </ResizablePanel>
      </Group>
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

function PullRequestListPane({
  error,
  items,
  loading,
  onSelect,
  selected,
}: {
  error: string | null;
  items: ReadonlyArray<PullRequestListItem>;
  loading: boolean;
  onSelect: (ref: PullRequestRef) => void;
  selected: PullRequestListItem | undefined;
}) {
  const [query, setQuery] = useState("");
  const visible = filterPullRequestItems(items, query);

  return (
    <>
      <div className="flex h-11 shrink-0 items-center gap-0.5 px-3 text-sm font-medium">
        <h1 className="sr-only">Pull requests</h1>
        <span className="bg-foreground/5 rounded-full px-2.5 py-1">All</span>
        <span className="text-muted-foreground px-2.5 py-1">Reviewing</span>
        <span className="text-muted-foreground px-2.5 py-1">Authored</span>
      </div>
      <div className="px-3 pb-3">
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
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2 pb-3">
        {error !== null ? (
          <p className="text-muted-foreground px-2 py-6 text-sm">{error}</p>
        ) : loading ? (
          <ul aria-hidden="true" className="flex flex-col gap-0.5">
            {Array.from({ length: 8 }, (_, index) => (
              <PullRequestListSkeletonRow key={index} />
            ))}
          </ul>
        ) : visible.length === 0 ? (
          <p className="text-muted-foreground px-2 py-6 text-sm">
            {query.trim().length > 0 ? "No matching pull requests." : "No open pull requests."}
          </p>
        ) : (
          <Collapsible defaultOpen>
            <h2 className="px-2">
              <CollapsibleTrigger className="text-muted-foreground hover:text-foreground group/pr-section flex h-8 w-full cursor-pointer items-center gap-1 text-xs font-medium">
                <ChevronRight className="size-3.5 transition-transform group-data-[panel-open]/pr-section:rotate-90" />
                Authored
              </CollapsibleTrigger>
            </h2>
            <CollapsiblePanel>
              <ul className="flex flex-col gap-0.5">
                {visible.map((item) => (
                  <PullRequestListRow
                    item={item}
                    key={`${item.ref.host}/${item.ref.owner}/${item.ref.repository}#${item.ref.number}`}
                    selected={selected !== undefined && samePullRequestRef(item.ref, selected.ref)}
                    onSelect={() => onSelect(item.ref)}
                  />
                ))}
              </ul>
            </CollapsiblePanel>
          </Collapsible>
        )}
      </div>
    </>
  );
}

function PullRequestListSkeletonRow() {
  return (
    <li className="flex gap-2 px-2 py-2">
      <span className="mt-1.5 size-2 shrink-0 overflow-hidden rounded-full">
        <Skeleton className="size-full" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-start justify-between gap-2">
          <Skeleton className="h-4 w-3/5" />
          <Skeleton className="h-3.5 w-14 shrink-0" />
        </div>
        <div className="flex items-center gap-1.5">
          <span className="size-4 shrink-0 overflow-hidden rounded-full">
            <Skeleton className="size-full" />
          </span>
          <Skeleton className="h-3 w-1/3" />
        </div>
      </div>
    </li>
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
  const age = formatPullRequestAge(item.updatedAt);
  const initial = (item.authorLogin[0] ?? "?").toUpperCase();
  const state =
    item.lifecycle.type === "open" && item.lifecycle.draft ? "draft" : item.lifecycle.type;
  return (
    <li>
      <button
        aria-label={item.title}
        className={cn(
          "hover:bg-accent flex w-full gap-2 rounded-lg px-2 py-2 text-left",
          selected && "bg-accent",
        )}
        data-state={selected ? "active" : "inactive"}
        onClick={onSelect}
        type="button"
      >
        <span
          aria-hidden
          className={cn(
            "mt-1.5 size-2 shrink-0 rounded-full",
            state === "open"
              ? "bg-pull-request-open"
              : state === "draft"
                ? "bg-pull-request-draft"
                : state === "closed"
                  ? "bg-pull-request-closed"
                  : "bg-pull-request-merged",
          )}
        />
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex items-start justify-between gap-2">
            <span className="line-clamp-2 text-sm font-medium">{item.title}</span>
            <span className="font-mono text-xs whitespace-nowrap tabular-nums">
              <span className="text-success">+{item.additions}</span>{" "}
              <span className="text-destructive">-{item.deletions}</span>
            </span>
          </span>
          <span className="text-muted-foreground flex min-w-0 items-center gap-1.5 text-xs">
            <Avatar className="size-4">
              <AvatarFallback>{initial}</AvatarFallback>
            </Avatar>
            <span className="min-w-0 truncate">{pullRequestRepositoryLabel(item.ref)}</span>
            {item.headBranch.length > 0 ? (
              <span className="min-w-0 truncate">{item.headBranch}</span>
            ) : null}
            {age.length > 0 ? <span className="shrink-0">{age}</span> : null}
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
  selected,
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
  selected: boolean;
  snapshot: PullRequestSnapshot | null | undefined;
}) {
  if (!selected) {
    return (
      <div className="text-muted-foreground flex min-w-0 flex-1 items-center justify-center text-sm">
        Select pull request to view
      </div>
    );
  }
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
