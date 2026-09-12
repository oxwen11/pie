import type { ListAgentModelsOutput } from "@getpie/contract";
import { Context, Effect, FileSystem, Layer } from "effect";
import { ChildProcessSpawner } from "effect/unstable/process";

import { AgentOperationError } from "./errors";
import { listAvailablePiModels } from "./pi/list-available-models";

type PiAgentServicePlatform = FileSystem.FileSystem | ChildProcessSpawner.ChildProcessSpawner;

export type PiAgentServiceShape = {
  readonly listModels: (cwd: string) => Effect.Effect<ListAgentModelsOutput, AgentOperationError>;
};

export class PiAgentService extends Context.Service<PiAgentService, PiAgentServiceShape>()(
  "PiAgentService",
) {}

export const makePiAgentService = (
  platform: Context.Context<PiAgentServicePlatform>,
): PiAgentServiceShape => ({
  listModels: (cwd) => listAvailablePiModels(cwd).pipe(Effect.provide(platform)),
});

export const PiAgentServiceLayer: Layer.Layer<PiAgentService, never, PiAgentServicePlatform> =
  Layer.effect(
    PiAgentService,
    Effect.gen(function* () {
      const platform = yield* Effect.context<PiAgentServicePlatform>();
      return makePiAgentService(platform);
    }),
  );
