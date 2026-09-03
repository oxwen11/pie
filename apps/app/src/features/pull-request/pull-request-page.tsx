import type {
  PullRequestListItem,
  PullRequestRef,
  PullRequestSnapshot,
} from "@getpie/contract/pull-request";
import { Response } from "@getpie/ui/ai-elements/response";
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
import { skipToken, useQuery } from "@tanstack/react-query";
import { useRouteContext } from "@tanstack/react-router";
import { ExternalLinkIcon, GitPullRequestIcon, SearchIcon } from "lucide-react";
import { useState } from "react";

import Loader from "@/components/loader";

import { PullRequestChecks } from "./pull-request-checks";
import {
  filterPullRequestItems,
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
      <PullRequestDetailPane
        body={detail.data?.body ?? ""}
        errorMessage={detail.error?.message}
        item={selected}
        pending={detail.isPending && detail.data === undefined}
        snapshot={detail.data?.snapshot}
      />
    </div>
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

function PullRequestDetailPane({
  body,
  errorMessage,
  item,
  pending,
  snapshot,
}: {
  body: string;
  errorMessage: string | undefined;
  item: PullRequestListItem | undefined;
  pending: boolean;
  snapshot: PullRequestSnapshot | undefined;
}) {
  if (item === undefined) {
    return <div className="min-w-0 flex-1" />;
  }

  return (
    <article className="flex min-w-0 flex-1 flex-col overflow-hidden">
      <header className="flex flex-col gap-2 border-b px-6 py-4">
        <div className="flex items-start justify-between gap-3">
          <h1 className="text-lg font-semibold text-pretty">{item.title}</h1>
          <a
            className="text-muted-foreground hover:bg-accent inline-flex size-7 shrink-0 items-center justify-center rounded-md"
            href={item.url}
            rel="noreferrer"
            target="_blank"
          >
            <ExternalLinkIcon className="size-3.5" />
            <span className="sr-only">Open on GitHub</span>
          </a>
        </div>
        <p className="text-muted-foreground text-sm">
          {item.authorLogin.length > 0 ? `${item.authorLogin} · ` : ""}
          {pullRequestRepositoryLabel(item.ref)}#{item.ref.number}
        </p>
        <p className="text-muted-foreground font-mono text-xs">
          {item.headBranch.length > 0 ? item.headBranch : "unknown"}
          {" > "}
          {item.baseBranch}
          <span className="ms-3 tabular-nums">
            <span className="text-success">+{item.additions}</span>
            <span className="text-destructive">-{item.deletions}</span>
          </span>
        </p>
      </header>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 py-4">
        {pending ? (
          <div className="flex flex-1 items-center justify-center">
            <Spinner className="text-muted-foreground size-4" />
          </div>
        ) : errorMessage !== undefined ? (
          <p className="text-muted-foreground text-sm">{errorMessage}</p>
        ) : (
          <div className="flex flex-col gap-6">
            {body.length > 0 ? <Response animated={false}>{body}</Response> : null}
            {snapshot === undefined ? null : <PullRequestChecks snapshot={snapshot} />}
          </div>
        )}
      </div>
    </article>
  );
}
