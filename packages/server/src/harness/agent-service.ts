import type { ListAgentModelsOutput } from "@pie/contract";
import { Context, Effect, Layer } from "effect";

import { AgentOperationError } from "./errors";
import { listAvailablePiModels } from "./pi/list-available-models";

export type PiAgentServiceShape = {
  readonly listModels: (cwd: string) => Effect.Effect<ListAgentModelsOutput, AgentOperationError>;
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
});

export const PiAgentServiceLayer = Layer.succeed(PiAgentService, makePiAgentService());
