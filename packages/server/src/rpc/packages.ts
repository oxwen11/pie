import { packagesContract } from "@getpie/contract/packages";
import { Effect } from "effect";

import { PackageService } from "../packages";
import type { RpcContext } from "./context";
import { implement } from "./orpc";

const orpc = implement(packagesContract).$context<RpcContext>();

export const packagesRouter = orpc.router({
  list: orpc.list.effect(function* () {
    const packages = yield* PackageService;
    return yield* packages.list();
  }),
  add: orpc.add.effect(function* ({ input, errors }) {
    const packages = yield* PackageService;
    return yield* packages.add(input.source).pipe(
      Effect.catchTags({
        InvalidPackageSource: (error) =>
          Effect.fail(errors.INVALID_ARGUMENT({ message: error.reason })),
      }),
    );
  }),
  remove: orpc.remove.effect(function* ({ input, errors }) {
    const packages = yield* PackageService;
    return yield* packages.remove(input.source).pipe(
      Effect.catchTags({
        PackageNotFound: (error) =>
          Effect.fail(errors.NOT_FOUND({ message: `package ${error.source} not found` })),
        PackageSettingsWriteFailed: (error) =>
          Effect.fail(errors.INTERNAL({ message: `could not save package ${error.source}` })),
      }),
    );
  }),
  search: orpc.search.effect(function* ({ input, errors }) {
    const packages = yield* PackageService;
    return yield* packages.search({ query: input.query, page: input.page }).pipe(
      Effect.catchTags({
        PackageCatalogUnavailable: (error) =>
          Effect.fail(errors.INTERNAL({ message: error.reason })),
      }),
    );
  }),
});

export type PackagesRouter = typeof packagesRouter;
