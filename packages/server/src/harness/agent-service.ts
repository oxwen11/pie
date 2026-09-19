import type { ListAgentModelsOutput } from "@getpie/contract";
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
  listModels: Effect.fn("PiAgentService.listModels")(function* (cwd: string) {
    return yield* listAvailablePiModels(cwd);
  }),
});

export const PiAgentServiceLayer = Layer.succeed(PiAgentService, makePiAgentService());
