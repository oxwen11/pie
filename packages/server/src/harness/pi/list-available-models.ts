import { getAgentDir, SettingsManager } from "@earendil-works/pi-coding-agent";
import * as NodeServices from "@effect/platform-node/NodeServices";
import type { ListAgentModelsOutput } from "@getpie/contract";
import { Effect } from "effect";

import { AgentOperationError } from "../errors";
import { type PiModelRef, toAgentModel } from "./model-mapping";
import { PI_PROJECT_PROCESS_ARGS, PI_PROJECT_SETTINGS_OPTIONS } from "./project-resource-policy";
import { resolveDefaultPiModel } from "./resolve-default-model";
import { resolvePiExecutable } from "./resolve-executable";
import { makePiTransport } from "./transport";

/**
 * Available models from a short-lived pie-pi-process `get_available_models`
 * — the same RPC a live session answers, so extension-registered providers
 * are included without running extension code in the daemon. The child exits
 * when the scope closes.
 */
export function listAvailablePiModels(
  cwd: string,
  agentDir = getAgentDir(),
): Effect.Effect<ListAgentModelsOutput, AgentOperationError> {
  return Effect.scoped(
    Effect.gen(function* () {
      const transport = yield* makePiTransport({
        executable: resolvePiExecutable(),
        cwd,
        args: PI_PROJECT_PROCESS_ARGS,
        env: { PI_CODING_AGENT_DIR: agentDir },
      });
      const data = yield* transport.command<{ models?: PiModelRef[] }>({
        type: "get_available_models",
      });
      const models = (data.models ?? []).map(toAgentModel);
      const settings = SettingsManager.create(cwd, agentDir, PI_PROJECT_SETTINGS_OPTIONS);
      const defaultModel = resolveDefaultPiModel(models, settings);
      return defaultModel === undefined ? { models } : { models, defaultModel };
    }),
  ).pipe(
    Effect.provide(NodeServices.layer),
    Effect.mapError(
      (cause) => new AgentOperationError({ sessionId: "", operation: "list-models", cause }),
    ),
    Effect.withSpan("pi.listAvailableModels", { attributes: { cwd } }),
  );
}
