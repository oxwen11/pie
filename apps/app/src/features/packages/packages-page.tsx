import type { PackageItem } from "@getpie/contract/packages";
import { Button } from "@getpie/ui/components/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@getpie/ui/components/empty";
import { cn } from "@getpie/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ChevronRight, Plus } from "lucide-react";
import { useState, type ReactElement } from "react";

import Loader from "@/components/loader";
import { useLocalOrpc } from "@/lib/environment-orpc";

import { PackageDetail } from "./package-detail";
import type { PackageDetail as PackageDetailModel } from "./package-model";
import { AddSourceForm, PackagesBrowse } from "./packages-browse";
import { usePackageMutations } from "./packages-mutations";
import { SkillsPanel } from "./skills-panel";

const tabs = [
  ["packages", "Packages"],
  ["skills", "Skills"],
] as const;

export function PackagesPage(): ReactElement {
  const [tab, setTab] = useState<(typeof tabs)[number][0]>("packages");
  const [addingSourceOpen, setAddingSourceOpen] = useState(false);
  const [detail, setDetail] = useState<PackageDetailModel | null>(null);
  const orpcQueryUtils = useLocalOrpc();
  const list = useQuery({
    ...orpcQueryUtils.packages.list.queryOptions(),
    meta: { errorMode: "inline" },
  });
  const { add, remove } = usePackageMutations(() => setAddingSourceOpen(false));
  const items = list.data ?? [];
  const addingSource = add.isPending ? add.variables : undefined;
  const removingSource = remove.isPending ? remove.variables : undefined;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-12 shrink-0 items-center justify-between px-3">
        {detail === null ? (
          <div
            aria-label="Browse packages or skills"
            className="flex items-center gap-0.5"
            role="tablist"
          >
            {tabs.map(([value, label]) => (
              <button
                aria-selected={tab === value}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-sm font-medium",
                  tab === value
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                )}
                key={value}
                onClick={() => {
                  setTab(value);
                  if (value !== "packages") setAddingSourceOpen(false);
                }}
                role="tab"
                type="button"
              >
                {label}
              </button>
            ))}
          </div>
        ) : (
          <div className="flex min-w-0 items-center gap-1 text-sm">
            <Button
              aria-label="Back to packages"
              onClick={() => setDetail(null)}
              size="icon-xs"
              type="button"
              variant="ghost"
            >
              <ArrowLeft />
            </Button>
            <button
              className="text-muted-foreground hover:text-foreground px-1.5 py-1"
              onClick={() => setDetail(null)}
              type="button"
            >
              Packages
            </button>
            <ChevronRight className="text-muted-foreground size-3.5" />
            <span className="truncate px-1.5 font-medium">{detail.name}</span>
          </div>
        )}
        {detail === null ? (
          <Button
            className="rounded-full"
            onClick={() => {
              setTab("packages");
              setAddingSourceOpen((open) => !open);
            }}
            size="sm"
            type="button"
            variant={addingSourceOpen ? "secondary" : "default"}
          >
            <Plus />
            Add
          </Button>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === "skills" ? (
          <SkillsPanel />
        ) : (
          <PackagesBody
            addingSource={addingSource}
            addingSourceOpen={addingSourceOpen}
            detail={detail}
            items={items}
            listError={list.isError ? list.error.message : null}
            listPending={list.isPending && list.data === undefined}
            onAdd={(source) => add.mutate(source)}
            onDetailChange={(next) => {
              setDetail(next);
              setAddingSourceOpen(false);
            }}
            onRemove={(source) => remove.mutate(source)}
            pending={add.isPending}
            removingSource={removingSource}
          />
        )}
      </div>
    </div>
  );
}

function PackagesBody({
  addingSource,
  addingSourceOpen,
  detail,
  items,
  listError,
  listPending,
  onAdd,
  onDetailChange,
  onRemove,
  pending,
  removingSource,
}: {
  addingSource: string | undefined;
  addingSourceOpen: boolean;
  detail: PackageDetailModel | null;
  items: ReadonlyArray<PackageItem>;
  listError: string | null;
  listPending: boolean;
  onAdd: (source: string) => void;
  onDetailChange: (detail: PackageDetailModel) => void;
  onRemove: (source: string) => void;
  pending: boolean;
  removingSource: string | undefined;
}): ReactElement {
  if (listPending) return <Loader />;
  if (listError !== null) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>Could not load packages</EmptyTitle>
          <EmptyDescription>{listError}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <>
      <div className={detail === null ? undefined : "hidden"}>
        <PackagesBrowse
          addSource={
            addingSourceOpen ? (
              <AddSourceForm addingSource={addingSource} onAdd={onAdd} pending={pending} />
            ) : null
          }
          addingSource={addingSource}
          items={items}
          onAdd={onAdd}
          onDetailChange={onDetailChange}
          onRemove={onRemove}
          removingSource={removingSource}
        />
      </div>
      {detail === null ? null : (
        <PackageDetail
          addingSource={addingSource}
          detail={detail}
          items={items}
          onAdd={onAdd}
          onRemove={onRemove}
          removingSource={removingSource}
        />
      )}
    </>
  );
}
