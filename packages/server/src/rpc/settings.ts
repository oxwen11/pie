import { settingsContract } from "@getpie/contract/settings";
import { Effect } from "effect";

import { SettingsService } from "../settings";
import type { RpcContext } from "./context";
import { implement } from "./orpc";

const orpc = implement(settingsContract).$context<RpcContext>();

const corruptMessage = (file: string, reason: "syntax" | "schema"): string =>
  reason === "syntax" ? `Could not parse ${file} as TOML` : `Invalid settings in ${file}`;

export const settingsRouter = orpc.router({
  get: orpc.get.effect(function* ({ errors }) {
    const settings = yield* SettingsService;
    return yield* settings.get().pipe(
      Effect.catchTags({
        SettingsCorrupt: (error) =>
          Effect.fail(
            errors.INVALID_ARGUMENT({ message: corruptMessage(error.file, error.reason) }),
          ),
        StoreReadError: (error) =>
          Effect.fail(errors.INTERNAL({ message: `Failed to read ${error.file}` })),
      }),
    );
  }),
  update: orpc.update.effect(function* ({ input, errors }) {
    const settings = yield* SettingsService;
    return yield* settings.update(input).pipe(
      Effect.catchTags({
        StoreWriteError: (error) =>
          Effect.fail(errors.INTERNAL({ message: `Failed to write ${error.file}` })),
      }),
    );
  }),
});

export type SettingsRouter = typeof settingsRouter;
