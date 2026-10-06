import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { ListAgentCommandsOutput, ListAgentModelsOutput } from "@getpie/contract";
import { Context, Effect, Layer } from "effect";

import type { AgentOperationError } from "../harness/errors";
import { listAvailablePiCommands } from "./list-available-commands";
import { listAvailablePiModels } from "./list-available-models";

export type PiAgentServiceShape = {
  readonly commands: (cwd?: string) => Effect.Effect<ListAgentCommandsOutput, AgentOperationError>;
  readonly listModels: (cwd?: string) => Effect.Effect<ListAgentModelsOutput, AgentOperationError>;
};

export class PiAgentService extends Context.Service<PiAgentService, PiAgentServiceShape>()(
  "PiAgentService",
) {}

export const PiAgentServiceLayer = Layer.succeed(PiAgentService, {
  commands: Effect.fn("PiAgentService.commands")(function* (cwd?: string) {
    return yield* listAvailablePiCommands(cwd);
  }),
  listModels: Effect.fn("PiAgentService.listModels")(function* (cwd?: string) {
    return yield* listAvailablePiModels(cwd ?? getAgentDir());
  }),
});
