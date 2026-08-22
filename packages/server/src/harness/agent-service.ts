import type { AgentModel } from "@pie/contract";
import { Context, Effect, Layer } from "effect";

import { AgentOperationError } from "./errors";
import { listAvailablePiModels } from "./pi/list-available-models";

export type HarnessAgentServiceShape = {
  readonly listModels: (
    cwd: string,
  ) => Effect.Effect<ReadonlyArray<AgentModel>, AgentOperationError>;
};

export class HarnessAgentService extends Context.Service<
  HarnessAgentService,
  HarnessAgentServiceShape
>()("HarnessAgentService") {}

export const makeHarnessAgentService = (): HarnessAgentServiceShape => ({
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

export const HarnessAgentServiceLayer = Layer.succeed(
  HarnessAgentService,
  makeHarnessAgentService(),
);
