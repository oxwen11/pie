import type { GetSettingsOutput, Settings } from "@getpie/contract";
import { Context, Effect, Layer } from "effect";

import type {
  SettingsDecodeError,
  SettingsParseError,
  StoreReadError,
  StoreWriteError,
} from "../errors";
import { SettingsRepository } from "./repository";

export class SettingsService extends Context.Service<
  SettingsService,
  {
    readonly get: () => Effect.Effect<
      GetSettingsOutput,
      StoreReadError | SettingsParseError | SettingsDecodeError
    >;
    readonly update: (
      settings: Settings,
    ) => Effect.Effect<
      GetSettingsOutput,
      StoreReadError | StoreWriteError | SettingsParseError | SettingsDecodeError
    >;
  }
>()("SettingsService") {}

export const SettingsServiceLayer: Layer.Layer<SettingsService, never, SettingsRepository> =
  Layer.effect(
    SettingsService,
    Effect.gen(function* () {
      const repo = yield* SettingsRepository;
      return {
        get: () => repo.read(),
        update: (settings) => repo.write(settings),
      };
    }),
  );
