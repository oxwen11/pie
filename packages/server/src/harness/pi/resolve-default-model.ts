import { SettingsManager } from "@earendil-works/pi-coding-agent";
import type { AgentModel } from "@getpie/contract";
import { Effect } from "effect";

/**
 * Pick `listModels.defaultModel`: the SettingsManager pair if it is in
 * the available models, otherwise the first row.
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

/**
 * Best-effort write of Pi's global default model. `cwd` is the project
 * settings root (`SettingsManager.create`'s first argument). The pair itself
 * lands in the agent dir. A flush failure must not fail session create or
 * setModel — the session record already stores that session's model.
 */
export const persistDefaultPiModel = (
  provider: string,
  modelId: string,
  cwd: string,
): Effect.Effect<void> =>
  Effect.tryPromise({
    try: async () => {
      const settings = SettingsManager.create(cwd);
      settings.setDefaultModelAndProvider(provider, modelId);
      await settings.flush();
      const failure = settings.drainErrors()[0];
      if (failure) throw failure.error;
    },
    catch: (cause) => cause,
  }).pipe(
    Effect.tapError((cause) =>
      Effect.logWarning("failed to persist default Pi model", cause).pipe(
        Effect.annotateLogs({
          event: "pi.default_model_persist_failed",
          provider,
          modelId,
          cwd,
        }),
      ),
    ),
    Effect.ignore,
  );
