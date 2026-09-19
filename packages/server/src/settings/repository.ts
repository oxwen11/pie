import {
  decodeSettingsJson,
  DEFAULT_SETTINGS,
  encodeSettingsJson,
  type Settings,
} from "@getpie/contract";
import { writeFileAtomic } from "@getpie/effect-json-store";
import { Context, Effect, FileSystem, Layer, Semaphore } from "effect";

import { Paths } from "../config/paths";
import { SettingsFileError, StoreReadError, StoreWriteError } from "../errors";

export class SettingsRepository extends Context.Service<
  SettingsRepository,
  {
    readonly get: () => Effect.Effect<Settings, StoreReadError | SettingsFileError>;
    readonly update: (settings: Settings) => Effect.Effect<Settings, StoreWriteError>;
  }
>()("SettingsRepository") {}

export const SettingsRepositoryLayer: Layer.Layer<
  SettingsRepository,
  never,
  Paths | FileSystem.FileSystem
> = Layer.effect(
  SettingsRepository,
  Effect.gen(function* () {
    const paths = yield* Paths;
    const fs = yield* FileSystem.FileSystem;
    const writeGate = yield* Semaphore.make(1);
    const file = paths.settingsFile;

    const read = (): Effect.Effect<Settings, StoreReadError | SettingsFileError> =>
      fs.readFileString(file).pipe(
        Effect.matchEffect({
          onFailure: (error) =>
            error.reason._tag === "NotFound"
              ? Effect.succeed(DEFAULT_SETTINGS)
              : Effect.fail(new StoreReadError({ file, cause: error })),
          onSuccess: (raw) =>
            Effect.try({
              try: () => decodeSettingsJson(raw),
              catch: (cause) => new SettingsFileError({ file, cause }),
            }),
        }),
      );

    return {
      get: read,
      update: (settings) =>
        writeGate.withPermit(
          Effect.gen(function* () {
            yield* writeFileAtomic(fs, file, encodeSettingsJson(settings)).pipe(
              Effect.mapError((error) => new StoreWriteError({ file, cause: error })),
            );
            return settings;
          }),
        ),
    };
  }),
);
