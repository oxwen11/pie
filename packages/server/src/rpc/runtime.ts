import * as NodeChildProcessSpawner from "@effect/platform-node/NodeChildProcessSpawner";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodeHttpPlatform from "@effect/platform-node/NodeHttpPlatform";
import * as NodePath from "@effect/platform-node/NodePath";
import { Context, Effect, type FileSystem, Layer } from "effect";

import { PathsLayer } from "../config/paths";
import { EventBusLayer } from "../events";
import { FileSystemServiceLayer } from "../fs";
import {
  type HarnessAgentAdapter,
  HarnessAgentSessionManagerLayer,
  HarnessAgentSessionServiceLayer,
} from "../harness";
import { makePiAdapter, makePiAgent, type PiAgent } from "../harness/pi";
import { PiAdapter } from "../harness/pi-adapter";
import { ProjectRepositoryLayer, ProjectServiceLayer } from "../project";

export class Pi extends Context.Service<Pi, PiAgent>()("Pi") {}

/**
 * The Node platform services. Every effect that touches disk, paths, or random
 * bytes bubbles these up its `R` channel; this is the one place they are
 * satisfied for the server runtime.
 */
const PlatformLayer = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer, NodeCrypto.layer);

const NodeProcessLayer = NodeChildProcessSpawner.layer.pipe(Layer.provide(PlatformLayer));

const piAgentOptions =
  process.env.PIE_E2E === "1" && process.env.PIE_E2E_PI_EXECUTABLE
    ? { executablePath: process.env.PIE_E2E_PI_EXECUTABLE }
    : {};

export const PiLayer: Layer.Layer<Pi> = Layer.effect(Pi, makePiAgent(piAgentOptions)).pipe(
  Layer.provide(NodeProcessLayer),
);

const ProvidersLayer = PiLayer;

/**
 * Whether Pi is installed is fixed for the life of the process — but every
 * `session.create` asks again. Cache it here so the answer costs one spawn per
 * server rather than one per call.
 */
export const cacheAvailability = (
  adapter: HarnessAgentAdapter,
): Effect.Effect<HarnessAgentAdapter, never, FileSystem.FileSystem> =>
  Effect.map(Effect.cached(adapter.checkAvailability), (cachedCheck) => ({
    ...adapter,
    checkAvailability: Effect.uninterruptible(cachedCheck),
  }));

const PiAdapterProvided = Layer.effect(
  PiAdapter,
  Effect.gen(function* () {
    const pi = yield* Pi;
    const adapter = yield* cacheAvailability(makePiAdapter(pi, piAgentOptions));
    return adapter;
  }),
).pipe(Layer.provide(ProvidersLayer), Layer.provide(PlatformLayer));

// The session stack: the manager owns all live state (instances + projections,
// publishing wire events onto the bus); the outward façade on top does the
// identity translation, metadata persistence, and collection events.
const HarnessSessionManagerProvided = HarnessAgentSessionManagerLayer.pipe(
  Layer.provide(PiAdapterProvided),
  Layer.provide(EventBusLayer),
  Layer.provide(PlatformLayer),
);
const HarnessSessionServiceProvided = HarnessAgentSessionServiceLayer.pipe(
  Layer.provide(HarnessSessionManagerProvided),
  Layer.provide(PiAdapterProvided),
  Layer.provide(EventBusLayer),
  Layer.provide(PathsLayer),
  Layer.provide(PlatformLayer),
);

const ProjectServiceProvided = ProjectServiceLayer.pipe(
  Layer.provide(ProjectRepositoryLayer),
  Layer.provide(PathsLayer),
  Layer.provide(PlatformLayer),
);

export const AgentRuntimeLayer = Layer.mergeAll(
  EventBusLayer,
  HarnessSessionServiceProvided,
  ProjectServiceProvided,
  PiAdapterProvided,
  FileSystemServiceLayer.pipe(Layer.provide(PlatformLayer)),
  PlatformLayer,
  NodeHttpPlatform.layer,
);
