import { settingsContract } from "@getpie/contract/settings";
import { Effect } from "effect";

import { SettingsRepository } from "../settings";
import type { RpcContext } from "./context";
import { implement } from "./orpc";

const orpc = implement(settingsContract).$context<RpcContext>();

export const settingsRouter = orpc.router({
  get: orpc.get.effect(function* ({ errors }) {
    const settings = yield* SettingsRepository;
    return yield* settings.get().pipe(
      Effect.catchTags({
        SettingsFileError: (error) =>
          Effect.fail(errors.INVALID_ARGUMENT({ message: `invalid settings file ${error.file}` })),
        StoreReadError: (error) =>
          Effect.fail(errors.INTERNAL({ message: `settings store read failed: ${error.file}` })),
      }),
    );
  }),
  update: orpc.update.effect(function* ({ input, errors }) {
    const settings = yield* SettingsRepository;
    return yield* settings.update(input).pipe(
      Effect.catchTags({
        StoreWriteError: (error) =>
          Effect.fail(errors.INTERNAL({ message: `settings store write failed: ${error.file}` })),
      }),
    );
  }),
});

export type SettingsRouter = typeof settingsRouter;
