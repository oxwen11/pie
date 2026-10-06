import { getAgentDir, SettingsManager } from "@earendil-works/pi-coding-agent";
import type { ListAgentModelsOutput } from "@getpie/contract";
import { type Duration, Effect } from "effect";

import { AgentOperationError } from "../errors";
import { runPiDiscoveryCommand } from "./discovery-command";
import { type PiModelRef, toAgentModel } from "./model-mapping";
import { PI_PROJECT_SETTINGS_OPTIONS } from "./project-resource-policy";
import { resolveDefaultPiModel } from "./resolve-default-model";

/**
 * Available models from a short-lived pie-pi-process `get_available_models`
 * — the same RPC a live session answers, so extension-registered providers
 * are included without running extension code in the daemon.
 */
export function listAvailablePiModels(
  cwd: string,
  agentDir = getAgentDir(),
  timeout?: Duration.Input,
): Effect.Effect<ListAgentModelsOutput, AgentOperationError> {
  return runPiDiscoveryCommand<{ models?: PiModelRef[] }>({
    cwd,
    agentDir,
    command: { type: "get_available_models" },
    timeout,
  }).pipe(
    Effect.map((data) => {
      const models = (data.models ?? []).map(toAgentModel);
      const settings = SettingsManager.create(cwd, agentDir, PI_PROJECT_SETTINGS_OPTIONS);
      const defaultModel = resolveDefaultPiModel(models, settings);
      return defaultModel === undefined ? { models } : { models, defaultModel };
    }),
    Effect.mapError(
      (cause) => new AgentOperationError({ sessionId: "", operation: "list-models", cause }),
    ),
    Effect.withSpan("pi.listAvailableModels", { attributes: { cwd } }),
  );
}
