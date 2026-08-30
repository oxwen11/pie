import { assetsContract } from "@getpie/contract/assets";
import { Effect } from "effect";

import {
  AssetFileTooLarge,
  AssetNotFound,
  AssetNotImage,
  AssetNotReferenced,
  AssetPathNotAllowed,
  AssetReadFailed,
  SessionImageAssets,
} from "../assets";
import { SessionNotFound } from "../errors";
import type { RpcContext } from "./context";
import { implement } from "./orpc";

const orpc = implement(assetsContract).$context<RpcContext>();

const message = (error: { readonly _tag: string }) => ({ message: error._tag });

export const assetsRouter = orpc.router({
  createUrl: orpc.createUrl.effect(function* ({ input, errors }) {
    const assets = yield* SessionImageAssets;
    return yield* assets.createUrl(input.ref, input.destination).pipe(
      Effect.catchTags({
        SessionNotFound: (error: SessionNotFound) =>
          Effect.fail(errors.SESSION_NOT_FOUND({ data: message(error) })),
        AssetNotReferenced: (error: AssetNotReferenced) =>
          Effect.fail(errors.NOT_REFERENCED({ data: message(error) })),
        AssetNotFound: (error: AssetNotFound) =>
          Effect.fail(errors.NOT_FOUND({ data: message(error) })),
        AssetPathNotAllowed: (error: AssetPathNotAllowed) =>
          Effect.fail(errors.PATH_NOT_ALLOWED({ data: message(error) })),
        AssetNotImage: (error: AssetNotImage) =>
          Effect.fail(errors.NOT_IMAGE({ data: message(error) })),
        AssetFileTooLarge: (error: AssetFileTooLarge) =>
          Effect.fail(errors.FILE_TOO_LARGE({ data: message(error) })),
        AssetReadFailed: (error: AssetReadFailed) =>
          Effect.fail(errors.READ_FAILED({ data: message(error) })),
      }),
    );
  }),
});

export type AssetsRouter = typeof assetsRouter;
