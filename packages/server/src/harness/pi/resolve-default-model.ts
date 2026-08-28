import type { AgentModel } from "@getpie/contract";

/**
 * Pi stores the startup default in SettingsManager
 * (`getDefaultProvider` / `getDefaultModel` — `~/.pi/agent/settings.json`,
 * project `.pi/settings.json` can override). `findInitialModel` is not on
 * the package public API; this is the public GET for that store, resolved
 * against the catalogue already built from `ModelRuntime.getAvailable()`.
 */
export type PiDefaultSettings = {
  readonly getDefaultProvider: () => string | undefined;
  readonly getDefaultModel: () => string | undefined;
};

export function resolveDefaultPiModel(
  models: ReadonlyArray<AgentModel>,
  settings: PiDefaultSettings,
): AgentModel | undefined {
  const provider = settings.getDefaultProvider();
  const modelId = settings.getDefaultModel();
  if (provider !== undefined && modelId !== undefined) {
    const match = models.find((model) => model.provider === provider && model.modelId === modelId);
    if (match) return match;
  }
  return models[0];
}
