import type { SkillItem } from "@getpie/contract/skills";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@getpie/ui/components/empty";
import { useQuery } from "@tanstack/react-query";
import { useRouteContext } from "@tanstack/react-router";
import { CheckIcon, SearchIcon, Sparkles } from "lucide-react";
import { useMemo, useState, type ReactElement } from "react";

import Loader from "@/components/loader";

function skillInitial(name: string): string {
  return name.slice(0, 1).toUpperCase();
}

export function SkillsPanel(): ReactElement {
  const { orpcQueryUtils } = useRouteContext({ from: "__root__" });
  const [query, setQuery] = useState("");
  const list = useQuery({
    ...orpcQueryUtils.skills.list.queryOptions(),
    meta: { errorMode: "inline" },
  });

  const items = useMemo(() => {
    const all: ReadonlyArray<SkillItem> = list.data ?? [];
    const needle = query.trim().toLowerCase();
    if (needle.length === 0) return all;
    return all.filter(
      (item) =>
        item.name.toLowerCase().includes(needle) ||
        item.description.toLowerCase().includes(needle) ||
        item.source.toLowerCase().includes(needle),
    );
  }, [list.data, query]);

  if (list.isPending && list.data === undefined) return <Loader />;

  if (list.isError) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>Could not load skills</EmptyTitle>
          <EmptyDescription>{list.error.message}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-6 pt-6 pb-10">
      <div className="min-w-0">
        <h1 className="text-3xl font-semibold tracking-tight">Skills</h1>
        <p className="text-muted-foreground mt-1 text-sm">Extend Pie with task-specific skills</p>
      </div>

      <div className="border-input bg-background flex h-11 items-center rounded-full border shadow-xs">
        <SearchIcon className="text-muted-foreground ml-3 size-4" />
        <input
          aria-label="Search skills"
          className="placeholder:text-muted-foreground min-w-0 flex-1 bg-transparent px-2 pr-4 text-sm outline-none"
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search skills"
          value={query}
        />
      </div>

      <section className="flex flex-col gap-4">
        <h2 className="text-base font-medium">Installed</h2>
        {items.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Sparkles aria-hidden="true" />
              </EmptyMedia>
              <EmptyTitle>No skills yet</EmptyTitle>
              <EmptyDescription>
                Drop a <code className="text-foreground">SKILL.md</code> folder into{" "}
                <code className="text-foreground">~/.pi/agent/skills</code> or install a package
                that ships skills.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {items.map((item) => (
              <li
                className="bg-muted/50 flex items-center gap-3 rounded-2xl px-3 py-3"
                key={`${item.source}:${item.path}`}
              >
                <div className="bg-muted flex size-11 shrink-0 items-center justify-center rounded-xl text-sm">
                  {skillInitial(item.name)}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{item.name}</p>
                  <p className="text-muted-foreground line-clamp-1 text-xs">{item.description}</p>
                </div>
                <CheckIcon aria-hidden="true" className="text-pull-request-open size-4 shrink-0" />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
