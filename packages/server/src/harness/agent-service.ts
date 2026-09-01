import type { ListAgentCommandsOutput, ListAgentModelsOutput } from "@getpie/contract";
import { Context, Effect, Layer } from "effect";

import { AgentOperationError } from "./errors";
import { listAvailablePiCommands } from "./pi/list-available-commands";
import { listAvailablePiModels } from "./pi/list-available-models";

export type PiAgentServiceShape = {
  readonly commands: (
    cwd?: string,
  ) => Effect.Effect<ListAgentCommandsOutput, AgentOperationError>;
  readonly listModels: (
    cwd?: string,
  ) => Effect.Effect<ListAgentModelsOutput, AgentOperationError>;
};

export class PiAgentService extends Context.Service<PiAgentService, PiAgentServiceShape>()(
  "PiAgentService",
) {}

export const makePiAgentService = (): PiAgentServiceShape => ({
  commands: Effect.fn("PiAgentService.commands")(function* (cwd?: string) {
    return yield* Effect.tryPromise({
      try: () => listAvailablePiCommands(cwd),
      catch: (cause) =>
        new AgentOperationError({
          sessionId: "",
          operation: "list-commands",
          cause,
        }),
    });
  }),
  listModels: Effect.fn("PiAgentService.listModels")(function* (cwd?: string) {
    return yield* listAvailablePiModels(cwd);
  }),
});

export const PiAgentServiceLayer = Layer.succeed(PiAgentService, makePiAgentService());
