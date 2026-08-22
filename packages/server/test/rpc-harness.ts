import * as NodeServices from "@effect/platform-node/NodeServices";
import { createRouterClient } from "@orpc/server";
import { Effect, Layer, ManagedRuntime } from "effect";

import { layerPaths } from "../src/config/paths";
import { EventBusLayer } from "../src/events";
import { FileSystemServiceLayer } from "../src/fs";
import {
  HarnessAgentRegistry,
  HarnessAgentSessionManagerLayer,
  HarnessAgentSessionServiceLayer,
  makeHarnessAgentRegistry,
} from "../src/harness";
import { makePiAdapter, makePiAgent } from "../src/harness/pi";
import * as Observability from "../src/observability";
import { ProjectRepositoryLayer, ProjectServiceLayer } from "../src/project";
import type { RpcContext } from "../src/rpc/context";
import { router } from "../src/rpc/router";
import { Pi } from "../src/rpc/runtime";

export async function makeRpcTestHarness(home: string) {
  const pathsLayer = Layer.provideMerge(layerPaths(home), NodeServices.layer);
  const piLayer = Layer.effect(Pi, makePiAgent()).pipe(Layer.provide(NodeServices.layer));
  const registryLayer = Layer.effect(
    HarnessAgentRegistry,
    Effect.gen(function* () {
      const pi = yield* Pi;
      return makeHarnessAgentRegistry(makePiAdapter(pi));
    }),
  ).pipe(Layer.provide(piLayer));

  const harnessSessionLayer = HarnessAgentSessionServiceLayer.pipe(
    Layer.provide(
      HarnessAgentSessionManagerLayer.pipe(
        Layer.provide(registryLayer),
        Layer.provide(EventBusLayer),
        Layer.provide(NodeServices.layer),
      ),
    ),
    Layer.provide(registryLayer),
    Layer.provide(EventBusLayer),
    Layer.provide(pathsLayer),
    Layer.provide(NodeServices.layer),
  );
  const projectServiceLayer = ProjectServiceLayer.pipe(
    Layer.provide(ProjectRepositoryLayer),
    Layer.provide(pathsLayer),
  );

  const appLayer = Layer.mergeAll(
    EventBusLayer,
    harnessSessionLayer,
    projectServiceLayer,
    registryLayer,
    FileSystemServiceLayer.pipe(Layer.provide(NodeServices.layer)),
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
