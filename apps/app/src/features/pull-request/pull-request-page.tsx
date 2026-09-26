import type {
  PullRequestAction,
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
import { Spinner } from "@getpie/ui/components/spinner";
import { cn } from "@getpie/ui/lib/utils";
import { skipToken, useQuery, type UseQueryResult } from "@tanstack/react-query";
import { ChevronRight, SearchIcon } from "lucide-react";
import { useState } from "react";
import { Group } from "react-resizable-panels";

import { PanelSeparator } from "@/components/layout/panel-separator";
import { ResizablePanel } from "@/components/layout/resizable-panel";
import { useLocalOrpc } from "@/lib/environment-orpc";

import { ConfirmPullRequestAction } from "./confirm-pull-request-action";
import { PullRequestInspect } from "./pull-request-inspect";
import { PullRequestPanelState } from "./pull-request-panel-state";
import {
  filterPullRequestItems,
  formatPullRequestAge,
  pullRequestActionInput,
  pullRequestRepositoryLabel,
  samePullRequestRef,
} from "./pull-request-presentation";
import { usePullRequestAction } from "./use-pull-request-action";

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
  const { intent, pending, postActionRefreshFailed, refresh, run, setIntent } =
    usePullRequestAction({
      mutationFn: (input) => orpcQueryUtils.pullRequest.runAction.call(input),
      mutationKey: orpcQueryUtils.pullRequest.runAction.key(),
      onApplied: () => {
        void list.refetch();
      },
      refetchDetail: () => detail.refetch(),
      refetchDiff: () => diff.refetch(),
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
        <PanelSeparator label="Resize pull request list" />
        <ResizablePanel className="flex min-w-0 flex-col" minSize="18rem">
          <PullRequestPageDetail
            actionPending={pending}
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
          loading={pending}
          onCancel={() => setIntent(null)}
          onConfirm={() => run(intent)}
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
        ) : loading ? null : visible.length === 0 ? (
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
