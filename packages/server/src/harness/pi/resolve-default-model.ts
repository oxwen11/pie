import type { AgentModel } from "@getpie/contract";

/**
 * Pick `listModels.defaultModel`: the SettingsManager pair if it is in the
 * catalogue, otherwise the first available row.
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
