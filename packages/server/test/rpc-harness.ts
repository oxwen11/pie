import * as NodeServices from "@effect/platform-node/NodeServices";
import { createRouterClient } from "@orpc/server";
import { Effect, Layer, ManagedRuntime } from "effect";

import { layerPaths } from "../src/config/paths";
import { EventBusLayer } from "../src/events";
import { FileSystemServiceLayer } from "../src/fs";
import { GitServiceLayer } from "../src/git";
import {
  PiAgentServiceLayer,
  PiAgentSessionManagerLayer,
  PiAgentSessionServiceLayer,
} from "../src/harness";
import { cachePiAgentAvailability, makePiAgent, PiAgent } from "../src/harness/pi/agent";
import { makePiProcess } from "../src/harness/pi/process";
import * as Observability from "../src/observability";
import { ProjectRepositoryLayer, ProjectServiceLayer } from "../src/project";
import type { RpcContext } from "../src/rpc/context";
import { router } from "../src/rpc/router";
import { PiProcessTag } from "../src/rpc/runtime";

export async function makeRpcTestHarness(home: string) {
  const pathsLayer = Layer.provideMerge(layerPaths(home), NodeServices.layer);
  const piProcessLayer = Layer.effect(PiProcessTag, makePiProcess()).pipe(
    Layer.provide(NodeServices.layer),
  );
  const piAgentLayer = Layer.effect(
    PiAgent,
    Effect.gen(function* () {
      const process = yield* PiProcessTag;
      return yield* cachePiAgentAvailability(makePiAgent(process));
    }),
  ).pipe(Layer.provide(piProcessLayer), Layer.provide(NodeServices.layer));

  const harnessSessionLayer = PiAgentSessionServiceLayer.pipe(
    Layer.provide(
      PiAgentSessionManagerLayer.pipe(
        Layer.provide(piAgentLayer),
        Layer.provide(EventBusLayer),
        Layer.provide(NodeServices.layer),
      ),
    ),
    Layer.provide(piAgentLayer),
    Layer.provide(EventBusLayer),
    Layer.provide(ProjectRepositoryLayer),
    Layer.provide(pathsLayer),
    Layer.provide(NodeServices.layer),
  );
  const projectServiceLayer = ProjectServiceLayer.pipe(
    Layer.provide(ProjectRepositoryLayer),
    Layer.provide(pathsLayer),
  );
  const appLayer = Layer.mergeAll(
    EventBusLayer,
    PiAgentServiceLayer,
    harnessSessionLayer,
    projectServiceLayer,
    piAgentLayer,
    piProcessLayer,
    FileSystemServiceLayer.pipe(Layer.provide(NodeServices.layer)),
    GitServiceLayer.pipe(
      Layer.provide(FileSystemServiceLayer),
      Layer.provide(pathsLayer),
      Layer.provide(NodeServices.layer),
    ),
    NodeServices.layer,
    Observability.discard,
  );
  const runtime = ManagedRuntime.make(appLayer);
  const context: RpcContext = {
    "effect/context": await runtime.runPromise(runtime.contextEffect),
  };
  const client = createRouterClient(router, { context });
  return { client, dispose: () => runtime.dispose() };
}
