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
import { assignUiTheme, decodeSettings, parseSettingsJson, stringifySettingsJson } from "./codec";

export class SettingsRepository extends Context.Service<
  SettingsRepository,
  {
    readonly read: () => Effect.Effect<
      GetSettingsOutput,
      StoreReadError | SettingsParseError | SettingsDecodeError
    >;
    readonly write: (
      settings: Settings,
    ) => Effect.Effect<
      GetSettingsOutput,
      StoreReadError | StoreWriteError | SettingsParseError | SettingsDecodeError
    >;
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
        try: () => parseSettingsJson(text),
        catch: (cause) => new SettingsParseError({ file, cause }),
      }).pipe(
        Effect.flatMap((raw) =>
          Effect.try({
            try: () => decodeSettings(raw),
            catch: (cause) => new SettingsDecodeError({ file, cause }),
          }),
        ),
      );

    const readExisting = () =>
      fs
        .readFileString(file)
        .pipe(
          Effect.catch((error) =>
            error.reason._tag === "NotFound"
              ? Effect.succeed("")
              : Effect.fail(new StoreReadError({ file, cause: error })),
          ),
        );

    return {
      read: () =>
        readExisting().pipe(
          Effect.flatMap(decodeFile),
          Effect.map((settings) => ({ path: file, settings })),
        ),
      write: (settings) =>
        Effect.gen(function* () {
          yield* Schema.encodeEffect(SettingsSchema)(settings).pipe(
            Effect.mapError((cause) => new SettingsDecodeError({ file, cause })),
          );
          const text = yield* readExisting();
          const raw = yield* Effect.try({
            try: () => parseSettingsJson(text),
            catch: (cause) => new SettingsParseError({ file, cause }),
          });
          const body = yield* Effect.try({
            try: () => stringifySettingsJson(assignUiTheme(raw, settings.ui.theme)),
            catch: (cause) => new SettingsDecodeError({ file, cause }),
          });
          yield* writeFileAtomic(fs, file, body, { mode: CONFIG_FILE_MODE }).pipe(
            Effect.mapError((cause) => new StoreWriteError({ file, cause })),
          );
          return { path: file, settings };
        }),
    };
  }),
);
