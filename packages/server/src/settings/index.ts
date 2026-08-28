import { type FileSystem, Layer } from "effect";

import type { Paths } from "../config/paths";
import { SettingsRepositoryLayer } from "./repository";
import { SettingsService, SettingsServiceLayer } from "./service";

export { SettingsRepository, SettingsRepositoryLayer } from "./repository";
export { SettingsService, SettingsServiceLayer } from "./service";
export {
  DEFAULT_SETTINGS,
  decodeSettings,
  overlaySettingsDefaults,
  parseSettingsToml,
  stringifySettingsToml,
} from "./codec";

export const SettingsModuleLayer: Layer.Layer<
  SettingsService,
  never,
  Paths | FileSystem.FileSystem
> = SettingsServiceLayer.pipe(Layer.provide(SettingsRepositoryLayer));
