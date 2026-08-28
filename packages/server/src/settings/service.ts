import type { Settings, SettingsView } from "@getpie/contract/settings";
import { SETTINGS_DEFAULTS } from "@getpie/contract/settings";
import { writeFileAtomic } from "@getpie/effect-json-store";
import { Context, Effect, FileSystem, Layer, Semaphore } from "effect";

import { CONFIG_FILE_MODE, Paths } from "../config/paths";
import { SettingsCorrupt, StoreReadError, StoreWriteError } from "../errors";
import { parseSettingsToml, stringifySettingsToml } from "./codec";

export class SettingsService extends Context.Service<
  SettingsService,
  {
    readonly get: () => Effect.Effect<SettingsView, StoreReadError | SettingsCorrupt>;
    readonly update: (settings: Settings) => Effect.Effect<SettingsView, StoreWriteError>;
  }
>()("SettingsService") {}

export const SettingsServiceLayer: Layer.Layer<
  SettingsService,
  never,
  Paths | FileSystem.FileSystem
> = Layer.effect(
  SettingsService,
  Effect.gen(function* () {
    const paths = yield* Paths;
    const fs = yield* FileSystem.FileSystem;
    const file = paths.configFile;
    const writeGate = yield* Semaphore.make(1);

    const missing = (): SettingsView => ({
      settings: SETTINGS_DEFAULTS,
      path: file,
      exists: false,
    });

    return {
      get: () =>
        fs.readFileString(file).pipe(
          Effect.map((text): string | undefined => text),
          Effect.catch((error) =>
            error.reason._tag === "NotFound"
              ? Effect.succeed(undefined)
              : Effect.fail(new StoreReadError({ file, cause: error })),
          ),
          Effect.flatMap((text) => {
            if (text === undefined) return Effect.succeed(missing());
            const parsed = parseSettingsToml(text);
            if (!parsed.ok) {
              return Effect.fail(
                new SettingsCorrupt({ file, reason: parsed.reason, cause: parsed.cause }),
              );
            }
            return Effect.succeed({
              settings: parsed.settings,
              path: file,
              exists: true as const,
            });
          }),
        ),

      update: (settings) =>
        writeGate.withPermit(
          writeFileAtomic(fs, file, stringifySettingsToml(settings), {
            mode: CONFIG_FILE_MODE,
          }).pipe(
            Effect.mapError((cause) => new StoreWriteError({ file, cause })),
            Effect.as({ settings, path: file, exists: true as const }),
          ),
        ),
    };
  }),
);
