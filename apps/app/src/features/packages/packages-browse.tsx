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
import { useQuery } from "@tanstack/react-query";
import { Package, SearchIcon, Trash2 } from "lucide-react";
import { useState, type ReactElement, type ReactNode } from "react";

import Loader from "@/components/loader";
import { useLocalOrpc } from "@/lib/environment-orpc";

import {
  catalogPageRange,
  detailFromCatalog,
  detailFromInstalled,
  formatDownloads,
  isConfigured,
  packageInitial,
  packageLabel,
  type PackageDetail,
} from "./package-model";

export function AddSourceForm({
  addingSource,
  pending,
  onAdd,
}: {
  addingSource: string | undefined;
  pending: boolean;
  onAdd: (source: string) => void;
}): ReactElement {
  const [source, setSource] = useState("");
  const trimmedSource = source.trim();
  return (
    <form
      className="flex flex-col gap-2 sm:flex-row"
      onSubmit={(event) => {
        event.preventDefault();
        if (trimmedSource.length === 0 || pending) return;
        onAdd(trimmedSource);
      }}
    >
      <InputGroup className="min-w-0 flex-1">
        <InputGroupInput
          aria-label="Package source"
          disabled={pending}
          name="source"
          onChange={(event) => setSource(event.target.value)}
          placeholder="npm:@scope/pkg@1.0.0 or git:github.com/user/repo@v1"
          value={source}
        />
      </InputGroup>
      <Button disabled={pending || trimmedSource.length === 0} type="submit">
        {addingSource === trimmedSource ? <Spinner className="size-4" /> : null}
        Save
      </Button>
    </form>
  );
}

export function PackagesBrowse({
  addSource,
  addingSource,
  items,
  onAdd,
  onDetailChange,
  onRemove,
  removingSource,
}: {
  addSource?: ReactNode;
  addingSource: string | undefined;
  items: ReadonlyArray<PackageItem>;
  onAdd: (source: string) => void;
  onDetailChange: (detail: PackageDetail) => void;
  onRemove: (source: string) => void;
  removingSource: string | undefined;
}): ReactElement {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-6 pt-6 pb-10">
      <div className="min-w-0">
        <h1 className="text-3xl font-semibold tracking-tight">Packages</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Work with Pie across your favorite tools
        </p>
      </div>
      {addSource}
      <Marketplace
        addingSource={addingSource}
        items={items}
        onAdd={onAdd}
        onDetailChange={onDetailChange}
      >
        {(catalogItems) => (
          <InstalledPackages
            catalogItems={catalogItems}
            items={items}
            onDetailChange={onDetailChange}
            onRemove={onRemove}
            removingSource={removingSource}
          />
        )}
      </Marketplace>
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
  children,
  items,
  onAdd,
  onDetailChange,
}: {
  addingSource: string | undefined;
  children: (catalogItems: ReadonlyArray<PackageCatalogItem>) => ReactNode;
  items: ReadonlyArray<PackageItem>;
  onAdd: (source: string) => void;
  onDetailChange: (detail: PackageDetail) => void;
}): ReactElement {
  const orpcQueryUtils = useLocalOrpc();
  const [catalogInput, setCatalogInput] = useState("");
  const [catalogQuery, setCatalogQuery] = useState("");
  const [catalogPage, setCatalogPage] = useState(1);
  const catalog = useQuery({
    ...orpcQueryUtils.packages.search.queryOptions({
      input: { query: catalogQuery, page: catalogPage },
    }),
    meta: { errorMode: "inline" },
  });
  const catalogItems = catalog.data?.items ?? [];
  const catalogTotal = catalog.data?.total ?? 0;
  const pageSize = catalog.data?.pageSize ?? 50;
  const { pageCount, pageEnd, pageStart } = catalogPageRange(catalogPage, pageSize, catalogTotal);
  const catalogError = catalog.isError ? catalog.error.message : null;

  return (
    <>
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
      {children(catalogItems)}
      <MarketplaceResults
        addingSource={addingSource}
        catalogError={catalogError}
        catalogItems={catalogItems}
        catalogPage={catalogPage}
        catalogTotal={catalogTotal}
        fetching={catalog.isFetching}
        items={items}
        onAdd={onAdd}
        onDetailChange={onDetailChange}
        onPageChange={setCatalogPage}
        pageCount={pageCount}
        pageEnd={pageEnd}
        pageStart={pageStart}
        pending={catalog.isPending && catalog.data === undefined}
      />
    </>
  );
}

function MarketplaceResults({
  addingSource,
  catalogError,
  catalogItems,
  catalogPage,
  catalogTotal,
  fetching,
  items,
  onAdd,
  onDetailChange,
  onPageChange,
  pageCount,
  pageEnd,
  pageStart,
  pending,
}: {
  addingSource: string | undefined;
  catalogError: string | null;
  catalogItems: ReadonlyArray<PackageCatalogItem>;
  catalogPage: number;
  catalogTotal: number;
  fetching: boolean;
  items: ReadonlyArray<PackageItem>;
  onAdd: (source: string) => void;
  onDetailChange: (detail: PackageDetail) => void;
  onPageChange: (page: number) => void;
  pageCount: number;
  pageEnd: number;
  pageStart: number;
  pending: boolean;
}): ReactElement {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <h2 className="text-base font-medium">Marketplace</h2>
        <MarketplaceRange
          end={pageEnd}
          fetching={fetching}
          start={pageStart}
          total={catalogTotal}
        />
      </div>
      <MarketplaceBody
        addingSource={addingSource}
        catalogError={catalogError}
        catalogItems={catalogItems}
        catalogPage={catalogPage}
        fetching={fetching}
        items={items}
        onAdd={onAdd}
        onDetailChange={onDetailChange}
        onPageChange={onPageChange}
        pageCount={pageCount}
        pending={pending}
      />
    </section>
  );
}

function MarketplaceRange({
  end,
  fetching,
  start,
  total,
}: {
  end: number;
  fetching: boolean;
  start: number;
  total: number;
}): ReactElement | null {
  if (fetching) {
    return (
      <p className="text-muted-foreground text-xs">
        <span className="inline-flex items-center gap-2">
          <Spinner className="size-3.5" />
          Searching…
        </span>
      </p>
    );
  }
  if (total === 0) return null;
  return (
    <p className="text-muted-foreground text-xs">
      {start}-{end} / {total}
    </p>
  );
}

function MarketplaceBody({
  addingSource,
  catalogError,
  catalogItems,
  catalogPage,
  fetching,
  items,
  onAdd,
  onDetailChange,
  onPageChange,
  pageCount,
  pending,
}: {
  addingSource: string | undefined;
  catalogError: string | null;
  catalogItems: ReadonlyArray<PackageCatalogItem>;
  catalogPage: number;
  fetching: boolean;
  items: ReadonlyArray<PackageItem>;
  onAdd: (source: string) => void;
  onDetailChange: (detail: PackageDetail) => void;
  onPageChange: (page: number) => void;
  pageCount: number;
  pending: boolean;
}): ReactElement {
  if (pending) return <Loader />;
  if (catalogError !== null) return <p className="text-destructive text-sm">{catalogError}</p>;
  if (catalogItems.length === 0 && !fetching) {
    return <p className="text-muted-foreground text-sm">No packages matched.</p>;
  }
  return (
    <>
      <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {catalogItems.map((item) => (
          <MarketplaceHit
            adding={addingSource === item.source}
            addDisabled={addingSource !== undefined}
            configured={isConfigured(items, item.name)}
            item={item}
            key={item.name}
            onAdd={onAdd}
            onDetailChange={onDetailChange}
          />
        ))}
      </ul>
      <MarketplacePager
        fetching={fetching}
        onPageChange={onPageChange}
        page={catalogPage}
        pageCount={pageCount}
      />
    </>
  );
}

function MarketplaceHit({
  addDisabled,
  adding,
  configured,
  item,
  onAdd,
  onDetailChange,
}: {
  addDisabled: boolean;
  adding: boolean;
  configured: boolean;
  item: PackageCatalogItem;
  onAdd: (source: string) => void;
  onDetailChange: (detail: PackageDetail) => void;
}): ReactElement {
  const downloads = formatDownloads(item.downloadsMonthly);
  return (
    <li className="bg-muted/50 hover:bg-muted/70 flex items-center rounded-2xl">
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
            <p className="text-muted-foreground line-clamp-1 text-xs">{item.description}</p>
          ) : null}
          <p className="text-muted-foreground mt-0.5 text-xs">
            {[item.version, item.publisher, downloads].filter(Boolean).join(" · ")}
          </p>
        </div>
      </button>
      <Button
        className="mr-3 rounded-full"
        disabled={configured || addDisabled}
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
}

function MarketplacePager({
  fetching,
  onPageChange,
  page,
  pageCount,
}: {
  fetching: boolean;
  onPageChange: (page: number) => void;
  page: number;
  pageCount: number;
}): ReactElement {
  return (
    <div className="flex items-center justify-between gap-2">
      <Button
        disabled={page <= 1 || fetching}
        onClick={() => onPageChange(Math.max(1, page - 1))}
        size="sm"
        type="button"
        variant="outline"
      >
        Previous
      </Button>
      <span className="text-muted-foreground text-xs">
        Page {page} / {pageCount}
      </span>
      <Button
        disabled={page >= pageCount || fetching}
        onClick={() => onPageChange(page + 1)}
        size="sm"
        type="button"
        variant="outline"
      >
        Next
      </Button>
    </div>
  );
}
