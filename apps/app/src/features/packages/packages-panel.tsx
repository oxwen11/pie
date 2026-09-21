import type { PackageCatalogItem, PackageItem } from "@getpie/contract/packages";
import { Button } from "@getpie/ui/components/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@getpie/ui/components/empty";
import { InputGroup, InputGroupInput } from "@getpie/ui/components/input-group";
import { Spinner } from "@getpie/ui/components/spinner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Package, SearchIcon, Trash2 } from "lucide-react";
import { useState, type ReactElement } from "react";
import { toast } from "sonner";

import Loader from "@/components/loader";
import { useLocalOrpc } from "@/lib/environment-orpc";

export type PackageDetail = {
  name: string;
  source: string;
  description?: string;
  version?: string;
  publisher?: string;
  downloadsMonthly?: number;
};

function isConfigured(items: ReadonlyArray<PackageItem>, name: string): boolean {
  const prefix = `npm:${name}`;
  return items.some((item) => item.source === prefix || item.source.startsWith(`${prefix}@`));
}

function configuredSource(items: ReadonlyArray<PackageItem>, name: string): string | undefined {
  const prefix = `npm:${name}`;
  return items.find((item) => item.source === prefix || item.source.startsWith(`${prefix}@`))
    ?.source;
}

function packageLabel(source: string): string {
  const bare = source.replace(/^npm:/, "").replace(/^git:/, "");
  if (bare.includes("github.com/")) {
    const parts = bare.replace(/^https?:\/\//, "").split(/[/@]/);
    return parts.at(-1) ?? bare;
  }
  const scoped = bare.split("@").find((part) => part.length > 0) ?? bare;
  return scoped.split("/").at(-1) ?? scoped;
}

function packageInitial(label: string): string {
  const bare = label.replace(/^@/, "").split("/").at(0) ?? label;
  return bare.slice(0, 1).toUpperCase();
}

function formatDownloads(value: number | undefined): string | null {
  if (value === undefined) return null;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M/mo`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K/mo`;
  return `${value}/mo`;
}

function detailFromCatalog(item: PackageCatalogItem): PackageDetail {
  return {
    name: item.name,
    source: item.source,
    description: item.description,
    version: item.version,
    publisher: item.publisher,
    downloadsMonthly: item.downloadsMonthly,
  };
}

function detailFromInstalled(
  item: PackageItem,
  catalogItems: ReadonlyArray<PackageCatalogItem>,
): PackageDetail {
  const label = packageLabel(item.source);
  const hit =
    catalogItems.find((entry) => entry.source === item.source) ??
    catalogItems.find((entry) => item.source === `npm:${entry.name}`) ??
    catalogItems.find((entry) => item.source.startsWith(`npm:${entry.name}@`));
  if (hit) return detailFromCatalog(hit);
  return { name: label, source: item.source };
}

function PackageDetailView({
  addingSource,
  detail,
  items,
  onAdd,
  onRemove,
  removingSource,
}: {
  addingSource: string | undefined;
  detail: PackageDetail;
  items: ReadonlyArray<PackageItem>;
  onAdd: (source: string) => void;
  onRemove: (source: string) => void;
  removingSource: string | undefined;
}): ReactElement {
  const configured =
    isConfigured(items, detail.name) || items.some((item) => item.source === detail.source);
  const activeSource = configuredSource(items, detail.name) ?? detail.source;
  const downloads = formatDownloads(detail.downloadsMonthly);
  const adding = addingSource === detail.source;
  const removing = removingSource === activeSource;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-6 pt-6 pb-10">
      <div className="flex items-end justify-between gap-6">
        <div className="min-w-0">
          <div className="bg-muted flex size-16 items-center justify-center rounded-2xl text-xl font-medium">
            {packageInitial(detail.name)}
          </div>
          <h1 className="mt-4 truncate text-2xl font-semibold tracking-tight">{detail.name}</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {detail.description ?? "Installed Pi package"}
          </p>
        </div>
        {configured ? (
          <Button
            className="shrink-0 rounded-full"
            disabled={removingSource !== undefined}
            onClick={() => onRemove(activeSource)}
            size="sm"
            type="button"
            variant="secondary"
          >
            {removing ? <Spinner className="size-4" /> : null}
            Remove package
          </Button>
        ) : (
          <Button
            className="shrink-0 rounded-full"
            disabled={addingSource !== undefined}
            onClick={() => onAdd(detail.source)}
            size="sm"
            type="button"
          >
            {adding ? <Spinner className="size-4" /> : null}
            Install package
          </Button>
        )}
      </div>

      <section>
        <h2 className="border-border border-b pb-3 text-base font-medium">Information</h2>
        <dl className="mt-4 grid grid-cols-[8rem_minmax(0,1fr)] gap-x-4 gap-y-3 text-sm">
          {detail.publisher ? (
            <>
              <dt className="text-muted-foreground">Developer</dt>
              <dd>{detail.publisher}</dd>
            </>
          ) : null}
          {detail.version ? (
            <>
              <dt className="text-muted-foreground">Version</dt>
              <dd>{detail.version}</dd>
            </>
          ) : null}
          {downloads ? (
            <>
              <dt className="text-muted-foreground">Downloads</dt>
              <dd>{downloads}</dd>
            </>
          ) : null}
          <dt className="text-muted-foreground">Status</dt>
          <dd>{configured ? "Installed" : "Available"}</dd>
          <dt className="text-muted-foreground">Source</dt>
          <dd className="break-all">{activeSource}</dd>
        </dl>
      </section>

      <p className="text-muted-foreground text-xs">
        Packages run with full system access — only install ones you trust.
      </p>
    </div>
  );
}

function InstalledPackages({
  catalogItems,
  items,
  onDetailChange,
  onRemove,
  removingSource,
}: {
  catalogItems: ReadonlyArray<PackageCatalogItem>;
  items: ReadonlyArray<PackageItem>;
  onDetailChange: (detail: PackageDetail) => void;
  onRemove: (source: string) => void;
  removingSource: string | undefined;
}): ReactElement {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-base font-medium">Installed</h2>
      {items.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Package aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>No packages yet</EmptyTitle>
            <EmptyDescription>
              Add a source or install from the catalog below. Packages run with full system access —
              only install ones you trust.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ul className="flex gap-5 overflow-x-auto pb-1">
          {items.map((item) => {
            const label = packageLabel(item.source);
            const removing = removingSource === item.source;
            return (
              <li key={item.source}>
                <div className="relative flex w-[4.5rem] shrink-0 flex-col items-center gap-2 text-center">
                  <button
                    className="flex w-full flex-col items-center gap-2"
                    onClick={() => onDetailChange(detailFromInstalled(item, catalogItems))}
                    type="button"
                  >
                    <div className="bg-muted flex size-16 items-center justify-center rounded-2xl text-lg font-medium">
                      {packageInitial(label)}
                    </div>
                    <p className="w-full truncate text-xs" title={item.source}>
                      {label}
                    </p>
                  </button>
                  <div className="absolute -top-1 -right-1">
                    <Button
                      aria-label={`Remove ${item.source}`}
                      className="rounded-full"
                      disabled={removingSource !== undefined}
                      onClick={() => onRemove(item.source)}
                      size="icon-xs"
                      type="button"
                      variant="secondary"
                    >
                      {removing ? (
                        <Spinner className="size-3.5" />
                      ) : (
                        <Trash2 className="size-3.5" />
                      )}
                    </Button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function Marketplace({
  addingSource,
  catalogError,
  catalogItems,
  catalogPage,
  catalogTotal,
  isFetching,
  isPending,
  items,
  onAdd,
  onDetailChange,
  onPageChange,
  pageCount,
  pageEnd,
  pageStart,
}: {
  addingSource: string | undefined;
  catalogError: string | null;
  catalogItems: ReadonlyArray<PackageCatalogItem>;
  catalogPage: number;
  catalogTotal: number;
  isFetching: boolean;
  isPending: boolean;
  items: ReadonlyArray<PackageItem>;
  onAdd: (source: string) => void;
  onDetailChange: (detail: PackageDetail) => void;
  onPageChange: (page: number) => void;
  pageCount: number;
  pageEnd: number;
  pageStart: number;
}): ReactElement {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <h2 className="text-base font-medium">Marketplace</h2>
        <p className="text-muted-foreground text-xs">
          {isFetching ? (
            <span className="inline-flex items-center gap-2">
              <Spinner className="size-3.5" />
              Searching…
            </span>
          ) : catalogTotal > 0 ? (
            `${pageStart}-${pageEnd} / ${catalogTotal}`
          ) : null}
        </p>
      </div>

      {isPending ? (
        <Loader />
      ) : catalogError ? (
        <p className="text-destructive text-sm">{catalogError}</p>
      ) : catalogItems.length === 0 && !isFetching ? (
        <p className="text-muted-foreground text-sm">No packages matched.</p>
      ) : (
        <>
          <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {catalogItems.map((item) => {
              const configured = isConfigured(items, item.name);
              const downloads = formatDownloads(item.downloadsMonthly);
              const adding = addingSource === item.source;
              return (
                <li
                  className="bg-muted/50 hover:bg-muted/70 flex items-center rounded-2xl"
                  key={item.name}
                >
                  <button
                    className="flex min-w-0 flex-1 items-center gap-3 p-3 text-left"
                    onClick={() => onDetailChange(detailFromCatalog(item))}
                    type="button"
                  >
                    <div className="bg-muted flex size-11 shrink-0 items-center justify-center rounded-xl text-sm">
                      {packageInitial(item.name)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{item.name}</p>
                      {item.description ? (
                        <p className="text-muted-foreground line-clamp-1 text-xs">
                          {item.description}
                        </p>
                      ) : null}
                      <p className="text-muted-foreground mt-0.5 text-xs">
                        {[item.version, item.publisher, downloads].filter(Boolean).join(" · ")}
                      </p>
                    </div>
                  </button>
                  <Button
                    className="mr-3 rounded-full"
                    disabled={configured || addingSource !== undefined}
                    onClick={() => onAdd(item.source)}
                    size="sm"
                    type="button"
                    variant="secondary"
                  >
                    {adding ? <Spinner className="size-4" /> : null}
                    {configured ? "Added" : "Install"}
                  </Button>
                </li>
              );
            })}
          </ul>
          <div className="flex items-center justify-between gap-2">
            <Button
              disabled={catalogPage <= 1 || isFetching}
              onClick={() => onPageChange(Math.max(1, catalogPage - 1))}
              size="sm"
              type="button"
              variant="outline"
            >
              Previous
            </Button>
            <span className="text-muted-foreground text-xs">
              Page {catalogPage} / {pageCount}
            </span>
            <Button
              disabled={catalogPage >= pageCount || isFetching}
              onClick={() => onPageChange(catalogPage + 1)}
              size="sm"
              type="button"
              variant="outline"
            >
              Next
            </Button>
          </div>
        </>
      )}
    </section>
  );
}

function AddSourceForm({
  addingSource,
  isPending,
  onAdd,
  onSourceChange,
  open,
  source,
}: {
  addingSource: string | undefined;
  isPending: boolean;
  onAdd: (source: string) => void;
  onSourceChange: (source: string) => void;
  open: boolean;
  source: string;
}): ReactElement | null {
  if (!open) return null;
  const trimmedSource = source.trim();
  return (
    <form
      className="flex flex-col gap-2 sm:flex-row"
      onSubmit={(event) => {
        event.preventDefault();
        if (trimmedSource.length === 0 || isPending) return;
        onAdd(trimmedSource);
      }}
    >
      <InputGroup className="min-w-0 flex-1">
        <InputGroupInput
          aria-label="Package source"
          disabled={isPending}
          name="source"
          onChange={(event) => onSourceChange(event.target.value)}
          placeholder="npm:@scope/pkg@1.0.0 or git:github.com/user/repo@v1"
          value={source}
        />
      </InputGroup>
      <Button disabled={isPending || trimmedSource.length === 0} type="submit">
        {addingSource === trimmedSource ? <Spinner className="size-4" /> : null}
        Save
      </Button>
    </form>
  );
}

function usePackageMutations(
  onAddingSourceOpenChange: (open: boolean) => void,
  setSource: (source: string) => void,
) {
  const orpcQueryUtils = useLocalOrpc();
  const queryClient = useQueryClient();
  const listKey = orpcQueryUtils.packages.list.queryOptions().queryKey;
  const add = useMutation({
    mutationFn: (next: string) => orpcQueryUtils.packages.add.call({ source: next }),
    onSuccess: (item) => {
      setSource("");
      onAddingSourceOpenChange(false);
      queryClient.setQueryData(listKey, (current: ReadonlyArray<PackageItem> | undefined) => {
        const items = current ?? [];
        if (items.some((entry) => entry.source === item.source)) {
          return items.map((entry) => (entry.source === item.source ? item : entry));
        }
        return [...items, item];
      });
      toast.success("Saved. Next session start installs missing packages.");
    },
    onError: (error) => toast.error(error.message),
  });
  const remove = useMutation({
    mutationFn: (next: string) => orpcQueryUtils.packages.remove.call({ source: next }),
    onSuccess: (_result, next) => {
      queryClient.setQueryData(listKey, (current: ReadonlyArray<PackageItem> | undefined) =>
        (current ?? []).filter((entry) => entry.source !== next),
      );
      toast.success("Removed from Pi settings");
    },
    onError: (error) => toast.error(error.message),
  });
  return { add, remove };
}

export function PackagesPanel({
  addingSourceOpen,
  detail,
  onAddingSourceOpenChange,
  onDetailChange,
}: {
  addingSourceOpen: boolean;
  detail: PackageDetail | null;
  onAddingSourceOpenChange: (open: boolean) => void;
  onDetailChange: (detail: PackageDetail | null) => void;
}): ReactElement {
  const orpcQueryUtils = useLocalOrpc();
  const list = useQuery({
    ...orpcQueryUtils.packages.list.queryOptions(),
    meta: { errorMode: "inline" },
  });
  const [source, setSource] = useState("");
  const [catalogInput, setCatalogInput] = useState("");
  const [catalogQuery, setCatalogQuery] = useState("");
  const [catalogPage, setCatalogPage] = useState(1);
  const { add, remove } = usePackageMutations(onAddingSourceOpenChange, setSource);
  const catalog = useQuery({
    ...orpcQueryUtils.packages.search.queryOptions({
      input: { query: catalogQuery, page: catalogPage },
    }),
    meta: { errorMode: "inline" },
  });
  if (list.isPending && list.data === undefined) return <Loader />;

  if (list.isError) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>Could not load packages</EmptyTitle>
          <EmptyDescription>{list.error.message}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  const items = list.data ?? [];
  const catalogItems: ReadonlyArray<PackageCatalogItem> = catalog.data?.items ?? [];
  const catalogTotal = catalog.data?.total ?? 0;
  const pageSize = catalog.data?.pageSize ?? 50;
  const pageStart = catalogTotal === 0 ? 0 : (catalogPage - 1) * pageSize + 1;
  const pageEnd = Math.min(catalogPage * pageSize, catalogTotal);
  const pageCount = Math.max(1, Math.ceil(catalogTotal / pageSize));
  const addingSource = add.isPending ? add.variables : undefined;
  const removingSource = remove.isPending ? remove.variables : undefined;

  if (detail !== null) {
    return (
      <PackageDetailView
        addingSource={addingSource}
        detail={detail}
        items={items}
        onAdd={(next) => add.mutate(next)}
        onRemove={(next) => remove.mutate(next)}
        removingSource={removingSource}
      />
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-6 pt-6 pb-10">
      <div className="min-w-0">
        <h1 className="text-3xl font-semibold tracking-tight">Packages</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Work with Pie across your favorite tools
        </p>
      </div>

      <AddSourceForm
        addingSource={addingSource}
        isPending={add.isPending}
        onAdd={(next) => add.mutate(next)}
        onSourceChange={setSource}
        open={addingSourceOpen}
        source={source}
      />

      <form
        onSubmit={(event) => {
          event.preventDefault();
          setCatalogPage(1);
          setCatalogQuery(catalogInput.trim());
        }}
      >
        <div className="border-input bg-background flex h-11 items-center rounded-full border shadow-xs">
          <SearchIcon className="text-muted-foreground ml-3 size-4" />
          <input
            aria-label="Search packages"
            className="placeholder:text-muted-foreground min-w-0 flex-1 bg-transparent px-2 pr-4 text-base outline-none"
            name="query"
            onChange={(event) => setCatalogInput(event.target.value)}
            placeholder="Search packages"
            value={catalogInput}
          />
        </div>
      </form>

      <InstalledPackages
        catalogItems={catalogItems}
        items={items}
        onDetailChange={onDetailChange}
        onRemove={(next) => remove.mutate(next)}
        removingSource={removingSource}
      />

      <Marketplace
        addingSource={addingSource}
        catalogError={catalog.isError ? catalog.error.message : null}
        catalogItems={catalogItems}
        catalogPage={catalogPage}
        catalogTotal={catalogTotal}
        isFetching={catalog.isFetching}
        isPending={catalog.isPending && catalog.data === undefined}
        items={items}
        onAdd={(next) => add.mutate(next)}
        onDetailChange={onDetailChange}
        onPageChange={setCatalogPage}
        pageCount={pageCount}
        pageEnd={pageEnd}
        pageStart={pageStart}
      />
    </div>
  );
}
