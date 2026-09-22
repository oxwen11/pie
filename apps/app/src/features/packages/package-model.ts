import type { PackageCatalogItem, PackageItem } from "@getpie/contract/packages";

export type PackageDetail = {
  name: string;
  source: string;
  description?: string;
  version?: string;
  publisher?: string;
  downloadsMonthly?: number;
};

export function isConfigured(items: ReadonlyArray<PackageItem>, name: string): boolean {
  const prefix = `npm:${name}`;
  return items.some((item) => item.source === prefix || item.source.startsWith(`${prefix}@`));
}

export function configuredSource(
  items: ReadonlyArray<PackageItem>,
  name: string,
): string | undefined {
  const prefix = `npm:${name}`;
  return items.find((item) => item.source === prefix || item.source.startsWith(`${prefix}@`))
    ?.source;
}

export function packageLabel(source: string): string {
  const bare = source.replace(/^npm:/, "").replace(/^git:/, "");
  if (bare.includes("github.com/")) {
    const parts = bare.replace(/^https?:\/\//, "").split(/[/@]/);
    return parts.at(-1) ?? bare;
  }
  const scoped = bare.split("@").find((part) => part.length > 0) ?? bare;
  return scoped.split("/").at(-1) ?? scoped;
}

export function packageInitial(label: string): string {
  const bare = label.replace(/^@/, "").split("/").at(0) ?? label;
  return bare.slice(0, 1).toUpperCase();
}

export function formatDownloads(value: number | undefined): string | null {
  if (value === undefined) return null;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M/mo`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K/mo`;
  return `${value}/mo`;
}

export function detailFromCatalog(item: PackageCatalogItem): PackageDetail {
  return {
    name: item.name,
    source: item.source,
    description: item.description,
    version: item.version,
    publisher: item.publisher,
    downloadsMonthly: item.downloadsMonthly,
  };
}

export function detailFromInstalled(
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

export interface CatalogPageRange {
  readonly pageCount: number;
  readonly pageEnd: number;
  readonly pageStart: number;
}

export function catalogPageRange(page: number, pageSize: number, total: number): CatalogPageRange {
  return {
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
    pageEnd: Math.min(page * pageSize, total),
    pageStart: total === 0 ? 0 : (page - 1) * pageSize + 1,
  };
}
