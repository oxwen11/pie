import { settingsContract } from "@getpie/contract/settings";
import { Effect } from "effect";

import {
  SettingsDecodeError,
  SettingsParseError,
  StoreReadError,
  StoreWriteError,
} from "../errors";
import { SettingsService } from "../settings";
import type { RpcContext } from "./context";
import { implement } from "./orpc";

const orpc = implement(settingsContract).$context<RpcContext>();

const describeCause = (cause: unknown): string =>
  cause instanceof Error ? cause.message : "invalid settings file";

export const settingsRouter = orpc.router({
  get: orpc.get.effect(function* ({ errors }) {
    const settings = yield* SettingsService;
    return yield* settings.get().pipe(
      Effect.catchTags({
        SettingsParseError: (error: SettingsParseError) =>
          Effect.fail(
            errors.INVALID_ARGUMENT({
              message: `${error.file}: ${describeCause(error.cause)}`,
            }),
          ),
        SettingsDecodeError: (error: SettingsDecodeError) =>
          Effect.fail(
            errors.INVALID_ARGUMENT({
              message: `${error.file}: ${describeCause(error.cause)}`,
            }),
          ),
        StoreReadError: (error: StoreReadError) =>
          Effect.fail(errors.INTERNAL({ message: `failed to read ${error.file}` })),
      }),
    );
  }),
  update: orpc.update.effect(function* ({ input, errors }) {
    const settings = yield* SettingsService;
    return yield* settings.update(input).pipe(
      Effect.catchTags({
        SettingsParseError: (error: SettingsParseError) =>
          Effect.fail(
            errors.INVALID_ARGUMENT({
              message: `${error.file}: ${describeCause(error.cause)}`,
            }),
          ),
        SettingsDecodeError: (error: SettingsDecodeError) =>
          Effect.fail(
            errors.INVALID_ARGUMENT({
              message: `${error.file}: ${describeCause(error.cause)}`,
            }),
          ),
        StoreReadError: (error: StoreReadError) =>
          Effect.fail(errors.INTERNAL({ message: `failed to read ${error.file}` })),
        StoreWriteError: (error: StoreWriteError) =>
          Effect.fail(errors.INTERNAL({ message: `failed to write ${error.file}` })),
      }),
    );
  }),
});

export type SettingsRouter = typeof settingsRouter;
