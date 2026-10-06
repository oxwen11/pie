import type { PackageItem } from "@getpie/contract/packages";
import { Button } from "@getpie/ui/components/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@getpie/ui/components/empty";
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@getpie/ui/components/sidebar";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, BookOpen, ChevronRight, Package, Plus } from "lucide-react";
import { useState, type ReactElement, type ReactNode } from "react";

import { PageSidebar } from "@/components/layout/page-sidebar";
import Loader from "@/components/loader";
import { useLocalOrpc } from "@/lib/environment-orpc";

import { PackageDetail } from "./package-detail";
import {
  detailFromInstalled,
  packageLabel,
  type PackageDetail as PackageDetailModel,
} from "./package-model";
import { AddSourceForm, PackagesBrowse } from "./packages-browse";
import { usePackageMutations } from "./packages-mutations";
import { SkillsPanel } from "./skills-panel";

const tabs = [
  ["packages", "Packages"],
  ["skills", "Skills"],
] as const;

export function PackagesPage(): ReactElement {
  const { setOpenMobile } = useSidebar();
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
  const addSourceButton = (
    <Button
      className="shrink-0 rounded-full"
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
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageSidebar>
        <div className="flex h-10 shrink-0 items-center px-4">
          <h2 className="text-sm font-semibold">Customize</h2>
        </div>
        <SidebarGroup className="pt-0">
          <SidebarMenu>
            {tabs.map(([value, label]) => (
              <SidebarMenuItem key={value}>
                <SidebarMenuButton
                  aria-pressed={tab === value && detail === null}
                  isActive={tab === value && detail === null}
                  onClick={() => {
                    setTab(value);
                    setDetail(null);
                    if (value !== "packages") setAddingSourceOpen(false);
                    setOpenMobile(false);
                  }}
                >
                  {value === "packages" ? <Package /> : <BookOpen />}
                  <span>{label}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroup>
        <SidebarGroup className="min-h-0 flex-1 overflow-y-auto">
          <SidebarGroupLabel>Installed</SidebarGroupLabel>
          <SidebarMenu>
            {items.map((item) => (
              <SidebarMenuItem key={item.source}>
                <SidebarMenuButton
                  aria-pressed={detail?.source === item.source}
                  isActive={detail?.source === item.source}
                  onClick={() => {
                    setTab("packages");
                    // ponytail: source-only details; reuse catalog metadata if richer sidebar details are needed.
                    setDetail(detailFromInstalled(item, []));
                    setAddingSourceOpen(false);
                    setOpenMobile(false);
                  }}
                  title={item.source}
                >
                  <Package />
                  <span>{packageLabel(item.source)}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroup>
      </PageSidebar>
      {detail === null ? null : (
        <div className="flex h-12 shrink-0 items-center px-3">
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
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === "skills" ? (
          <SkillsPanel>{addSourceButton}</SkillsPanel>
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
          >
            {addSourceButton}
          </PackagesBody>
        )}
      </div>
    </div>
  );
}

function PackagesBody({
  children,
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
  children: ReactNode;
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
        >
          {children}
        </PackagesBrowse>
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
