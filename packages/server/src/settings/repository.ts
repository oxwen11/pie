import { type GetSettingsOutput, type Settings, SettingsSchema } from "@getpie/contract";
import { writeFileAtomic } from "@getpie/effect-json-store";
import { Context, Effect, FileSystem, Layer, Schema } from "effect";

import { CONFIG_FILE_MODE, Paths } from "../config/paths";
import {
  SettingsDecodeError,
  SettingsParseError,
  StoreReadError,
  StoreWriteError,
} from "../errors";
import { decodeSettings, parseSettingsToml, stringifySettingsToml } from "./codec";

export class SettingsRepository extends Context.Service<
  SettingsRepository,
  {
    readonly read: () => Effect.Effect<
      GetSettingsOutput,
      StoreReadError | SettingsParseError | SettingsDecodeError
    >;
    readonly write: (
      settings: Settings,
    ) => Effect.Effect<GetSettingsOutput, StoreWriteError | SettingsDecodeError>;
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
    const file = paths.configFile;

    const decodeFile = (text: string) =>
      Effect.try({
        try: () => parseSettingsToml(text),
        catch: (cause) => new SettingsParseError({ file, cause }),
      }).pipe(
        Effect.flatMap((raw) =>
          Effect.try({
            try: () => decodeSettings(raw),
            catch: (cause) => new SettingsDecodeError({ file, cause }),
          }),
        ),
      );

    return {
      read: () =>
        fs.readFileString(file).pipe(
          Effect.catch((error) =>
            error.reason._tag === "NotFound"
              ? Effect.succeed("")
              : Effect.fail(new StoreReadError({ file, cause: error })),
          ),
          Effect.flatMap(decodeFile),
          Effect.map((settings) => ({ path: file, settings })),
        ),
      write: (settings) =>
        Schema.encodeEffect(SettingsSchema)(settings).pipe(
          Effect.mapError((cause) => new SettingsDecodeError({ file, cause })),
          Effect.flatMap(() =>
            writeFileAtomic(fs, file, stringifySettingsToml(settings), {
              mode: CONFIG_FILE_MODE,
            }).pipe(Effect.mapError((cause) => new StoreWriteError({ file, cause }))),
          ),
          Effect.as({ path: file, settings }),
        ),
    };
  }),
);
