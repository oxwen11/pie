import type { PackageItem } from "@getpie/contract/packages";
import { Button } from "@getpie/ui/components/button";
import { Spinner } from "@getpie/ui/components/spinner";
import type { ReactElement } from "react";

import {
  configuredSource,
  formatDownloads,
  isConfigured,
  packageInitial,
  type PackageDetail as PackageDetailModel,
} from "./package-model";

export function PackageDetail({
  addingSource,
  detail,
  items,
  onAdd,
  onRemove,
  removingSource,
}: {
  addingSource: string | undefined;
  detail: PackageDetailModel;
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
