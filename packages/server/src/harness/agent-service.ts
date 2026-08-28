import type { AgentModelState, ListAgentModelsOutput } from "@getpie/contract";
import { Context, Effect, Layer } from "effect";

import { AgentOperationError } from "./errors";
import { listAvailablePiModels } from "./pi/list-available-models";
import { persistDefaultPiModel } from "./pi/persist-default-model";

export type PiAgentServiceShape = {
  readonly listModels: (cwd: string) => Effect.Effect<ListAgentModelsOutput, AgentOperationError>;
  readonly setDefaultModel: (
    cwd: string,
    model: { readonly provider: string; readonly modelId: string },
  ) => Effect.Effect<AgentModelState, AgentOperationError>;
};

export class PiAgentService extends Context.Service<PiAgentService, PiAgentServiceShape>()(
  "PiAgentService",
) {}

export const makePiAgentService = (): PiAgentServiceShape => ({
  listModels: (cwd) =>
    Effect.tryPromise({
      try: () => listAvailablePiModels(cwd),
      catch: (cause) =>
        new AgentOperationError({
          sessionId: "",
          operation: "list-models",
          cause,
        }),
    }),
  setDefaultModel: (cwd, model) =>
    Effect.tryPromise({
      try: async () => {
        await persistDefaultPiModel(cwd, model);
        return model satisfies AgentModelState;
      },
      catch: (cause) =>
        new AgentOperationError({
          sessionId: "",
          operation: "persist-default-model",
          cause,
        }),
    }),
});

export const PiAgentServiceLayer = Layer.succeed(PiAgentService, makePiAgentService());
