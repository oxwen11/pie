import * as NodeChildProcessSpawner from "@effect/platform-node/NodeChildProcessSpawner";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodeHttpPlatform from "@effect/platform-node/NodeHttpPlatform";
import * as NodePath from "@effect/platform-node/NodePath";
import { Context, Effect, Layer } from "effect";

import { PathsLayer } from "../config/paths";
import { EventBusLayer } from "../events";
import { FileSystemServiceLayer } from "../fs";
import { GitServiceLayer, WorktreeServiceLayer } from "../git";
import {
  PiAgentSessionManagerLayer,
  PiAgentServiceLayer,
  PiAgentSessionServiceLayer,
} from "../harness";
import { cachePiAgentAvailability, makePiAgent, PiAgent } from "../harness/pi/agent";
import { makePiProcess, type PiProcess } from "../harness/pi/process";
import { resolvePiExecutable } from "../harness/pi/resolve-executable";
import { ProjectRepositoryLayer, ProjectServiceLayer } from "../project";
import { SettingsServiceLayer } from "../settings";

export class PiProcessTag extends Context.Service<PiProcessTag, PiProcess>()("PiProcess") {}

const PlatformLayer = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer, NodeCrypto.layer);

const NodeProcessLayer = NodeChildProcessSpawner.layer.pipe(Layer.provide(PlatformLayer));

const piExecutable = resolvePiExecutable();
const piProcessOptions = { executable: piExecutable };

export const PiProcessLayer: Layer.Layer<PiProcessTag> = Layer.effect(
  PiProcessTag,
  makePiProcess(piProcessOptions),
).pipe(Layer.provide(NodeProcessLayer));

const PiAgentProvided = Layer.effect(
  PiAgent,
  Effect.gen(function* () {
    const process = yield* PiProcessTag;
    const pi = yield* cachePiAgentAvailability(makePiAgent(process, piProcessOptions));
    return pi;
  }),
).pipe(Layer.provide(PiProcessLayer), Layer.provide(PlatformLayer));

const PiAgentSessionManagerProvided = PiAgentSessionManagerLayer.pipe(
  Layer.provide(PiAgentProvided),
  Layer.provide(EventBusLayer),
  Layer.provide(PlatformLayer),
);
const GitProvided = GitServiceLayer.pipe(
  Layer.provide(FileSystemServiceLayer),
  Layer.provide(PlatformLayer),
);
const WorktreeProvided = WorktreeServiceLayer.pipe(
  Layer.provide(PathsLayer),
  Layer.provide(PlatformLayer),
);

const ProjectServiceProvided = ProjectServiceLayer.pipe(
  Layer.provide(ProjectRepositoryLayer),
  Layer.provide(PathsLayer),
  Layer.provide(PlatformLayer),
);

const SettingsServiceProvided = SettingsServiceLayer.pipe(
  Layer.provide(PathsLayer),
  Layer.provide(PlatformLayer),
);

const PiAgentSessionServiceProvided = PiAgentSessionServiceLayer.pipe(
  Layer.provide(PiAgentSessionManagerProvided),
  Layer.provide(PiAgentProvided),
  Layer.provide(EventBusLayer),
  Layer.provide(ProjectServiceProvided),
  Layer.provide(PathsLayer),
  Layer.provide(WorktreeProvided),
  Layer.provide(PlatformLayer),
);

const PiAgentServiceProvided = PiAgentServiceLayer;

export const AgentRuntimeLayer = Layer.mergeAll(
  EventBusLayer,
  PiAgentServiceProvided,
  PiAgentSessionServiceProvided,
  ProjectServiceProvided,
  SettingsServiceProvided,
  PiAgentProvided,
  PiProcessLayer,
  FileSystemServiceLayer.pipe(Layer.provide(PlatformLayer)),
  GitProvided,
  WorktreeProvided,
  PlatformLayer,
  NodeHttpPlatform.layer,
);

// Re-export for tests that cached availability on a shape.
export const cacheAvailability = cachePiAgentAvailability;
