import {
  DefaultPackageManager,
  SettingsManager,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";
import type {
  PackageCatalogItem,
  PackageCatalogPage,
  PackageItem,
} from "@getpie/contract/packages";
import { Context, Effect, Layer, Schema } from "effect";

import {
  InvalidPackageSource,
  PackageCatalogUnavailable,
  PackageNotFound,
  PackageSettingsWriteFailed,
} from "../errors";

/** Match pi.dev/packages page size. */
const NPM_SEARCH_PAGE_SIZE = 50;

export type PackageServiceShape = {
  readonly list: () => Effect.Effect<ReadonlyArray<PackageItem>>;
  readonly add: (source: string) => Effect.Effect<PackageItem, InvalidPackageSource>;
  readonly remove: (
    source: string,
  ) => Effect.Effect<{ readonly removed: true }, PackageNotFound | PackageSettingsWriteFailed>;
  readonly search: (input: {
    readonly query?: string;
    readonly page?: number;
  }) => Effect.Effect<PackageCatalogPage, PackageCatalogUnavailable>;
};

export class PackageService extends Context.Service<PackageService, PackageServiceShape>()(
  "PackageService",
) {}

function packageManager(agentDir: string) {
  const settings = SettingsManager.create(agentDir, agentDir, { projectTrusted: true });
  return {
    manager: new DefaultPackageManager({ cwd: agentDir, agentDir, settingsManager: settings }),
    settings,
  };
}

async function flushSettings(settings: SettingsManager): Promise<void> {
  await settings.flush();
  const failure = settings.drainErrors()[0];
  if (failure) throw failure.error;
}

function toItem(pm: DefaultPackageManager, source: string): PackageItem {
  return {
    source,
    installed: pm.getInstalledPath(source, "user") !== undefined,
  };
}

const decodeNpmSearchResponse = Schema.decodeUnknownEffect(
  Schema.Struct({
    objects: Schema.optionalKey(
      Schema.Array(
        Schema.Struct({
          downloads: Schema.optionalKey(
            Schema.Struct({ monthly: Schema.optionalKey(Schema.Number) }),
          ),
          package: Schema.optionalKey(
            Schema.Struct({
              name: Schema.optionalKey(Schema.String),
              description: Schema.optionalKey(Schema.String),
              version: Schema.optionalKey(Schema.String),
              publisher: Schema.optionalKey(
                Schema.Struct({ username: Schema.optionalKey(Schema.String) }),
              ),
            }),
          ),
        }),
      ),
    ),
    total: Schema.optionalKey(Schema.Number),
  }),
);

const catalogUnavailable = (cause: unknown) =>
  new PackageCatalogUnavailable({
    reason: cause instanceof Error ? cause.message : String(cause),
  });

type MutableCatalogItem = {
  name: string;
  source: string;
  version: string;
  description?: string;
  publisher?: string;
  downloadsMonthly?: number;
};

function searchNpmPiPackages(
  input: { readonly query?: string; readonly page?: number },
  fetchImpl: typeof fetch,
): Effect.Effect<PackageCatalogPage, PackageCatalogUnavailable> {
  const requestedPage = input.page ?? 0;
  const page = Number.isFinite(requestedPage) && requestedPage > 0 ? Math.floor(requestedPage) : 1;
  const trimmed = input.query?.trim() ?? "";
  const text = trimmed.length === 0 ? "keywords:pi-package" : `${trimmed} keywords:pi-package`;
  const url = new URL("https://registry.npmjs.org/-/v1/search");
  url.searchParams.set("text", text);
  url.searchParams.set("size", String(NPM_SEARCH_PAGE_SIZE));
  url.searchParams.set("from", String((page - 1) * NPM_SEARCH_PAGE_SIZE));
  return Effect.gen(function* () {
    const response = yield* Effect.tryPromise({
      try: () => fetchImpl(url),
      catch: catalogUnavailable,
    });
    if (!response.ok) {
      return yield* new PackageCatalogUnavailable({
        reason: `npm search failed: ${response.status}`,
      });
    }
    const json: unknown = yield* Effect.tryPromise({
      try: () => response.json(),
      catch: catalogUnavailable,
    });
    const body = yield* decodeNpmSearchResponse(json).pipe(Effect.mapError(catalogUnavailable));
    const items: PackageCatalogItem[] = [];
    for (const hit of body.objects ?? []) {
      const name = hit.package?.name?.trim();
      const version = hit.package?.version?.trim();
      if (!name || !version) continue;
      const description = hit.package?.description?.trim();
      const publisher = hit.package?.publisher?.username?.trim();
      const downloadsMonthly = hit.downloads?.monthly;
      const item: MutableCatalogItem = { name, version, source: `npm:${name}` };
      if (description) item.description = description;
      if (publisher) item.publisher = publisher;
      if (typeof downloadsMonthly === "number") item.downloadsMonthly = downloadsMonthly;
      items.push(item);
    }
    return {
      items,
      total: typeof body.total === "number" ? body.total : items.length,
      page,
      pageSize: NPM_SEARCH_PAGE_SIZE,
    };
  });
}

/** Settings-only package ops. Session start auto-installs missing packages. */
export function makePackageService(
  agentDir: () => string = getAgentDir,
  fetchImpl: typeof fetch = globalThis.fetch,
): PackageServiceShape {
  return {
    list: () =>
      Effect.sync(() => {
        const { manager } = packageManager(agentDir());
        return manager
          .listConfiguredPackages()
          .filter((item) => item.scope === "user")
          .map((item) => toItem(manager, item.source));
      }),
    add: (raw) =>
      Effect.tryPromise({
        try: async () => {
          const source = raw.trim();
          if (source.length === 0) {
            throw new Error("Package source is empty");
          }
          const { manager, settings } = packageManager(agentDir());
          manager.addSourceToSettings(source);
          await flushSettings(settings);
          return toItem(manager, source);
        },
        catch: (cause) =>
          new InvalidPackageSource({
            source: raw,
            reason: cause instanceof Error ? cause.message : String(cause),
          }),
      }),
    remove: (raw) =>
      Effect.gen(function* () {
        const source = raw.trim();
        const { manager, settings } = packageManager(agentDir());
        const removed = manager.removeSourceFromSettings(source);
        if (!removed) {
          return yield* Effect.fail(new PackageNotFound({ source }));
        }
        yield* Effect.tryPromise({
          try: () => flushSettings(settings),
          catch: (cause) => new PackageSettingsWriteFailed({ source, cause }),
        });
        return { removed: true as const };
      }),
    search: (input) => searchNpmPiPackages(input, fetchImpl),
  };
}

export const PackageServiceLayer: Layer.Layer<PackageService> = Layer.succeed(
  PackageService,
  makePackageService(),
);
