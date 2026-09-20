import { Schema } from "effect";

import { serverErrors } from "./domain";
import { oc } from "./orpc";

const base = oc.errors(serverErrors);

export const PackageItemSchema = Schema.Struct({
  source: Schema.NonEmptyString,
  /** True when the package is already on disk under the agent dir. */
  installed: Schema.Boolean,
});
export type PackageItem = typeof PackageItemSchema.Type;

/** npm registry hit for `keywords:pi-package` (same discovery as pi.dev/packages). */
export const PackageCatalogItemSchema = Schema.Struct({
  name: Schema.NonEmptyString,
  source: Schema.NonEmptyString,
  version: Schema.NonEmptyString,
  description: Schema.optionalKey(Schema.String),
  publisher: Schema.optionalKey(Schema.String),
  downloadsMonthly: Schema.optionalKey(Schema.Number),
});
export type PackageCatalogItem = typeof PackageCatalogItemSchema.Type;

export const PackageCatalogPageSchema = Schema.Struct({
  items: Schema.Array(PackageCatalogItemSchema),
  total: Schema.Number,
  page: Schema.Number,
  pageSize: Schema.Number,
});
export type PackageCatalogPage = typeof PackageCatalogPageSchema.Type;

export const packagesContract = {
  list: base.output(Schema.Array(PackageItemSchema)),
  add: base.input(Schema.Struct({ source: Schema.NonEmptyString })).output(PackageItemSchema),
  remove: base
    .input(Schema.Struct({ source: Schema.NonEmptyString }))
    .output(Schema.Struct({ removed: Schema.Literal(true) })),
  search: base
    .input(
      Schema.Struct({
        query: Schema.optionalKey(Schema.String),
        /** 1-based page; defaults to 1. */
        page: Schema.optionalKey(Schema.Number),
      }),
    )
    .output(PackageCatalogPageSchema),
};
