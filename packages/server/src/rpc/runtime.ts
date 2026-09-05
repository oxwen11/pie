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
import { resolvePiExecutableEffect } from "../harness/pi/resolve-executable";
import { ProjectRepositoryLayer, ProjectServiceLayer } from "../project";
import { PullRequestServiceLayer } from "../pull-request";
import { runScheduleLoop, ScheduleRepositoryLayer, ScheduleServiceLayer } from "../schedule";

export class PiProcessTag extends Context.Service<PiProcessTag, PiProcess>()("pie/PiProcess") {}

const PlatformLayer = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer, NodeCrypto.layer);

const NodeProcessLayer = NodeChildProcessSpawner.layer.pipe(Layer.provide(PlatformLayer));

const Infra = Layer.mergeAll(PlatformLayer, PathsLayer, EventBusLayer);

export const PiProcessLayer: Layer.Layer<PiProcessTag> = Layer.effect(
  PiProcessTag,
  Effect.gen(function* () {
    const executable = yield* resolvePiExecutableEffect.pipe(Effect.orDie);
    return yield* makePiProcess({ executable });
  }),
).pipe(Layer.provide(NodeProcessLayer));

const PiAgentProvided = Layer.effect(
  PiAgent,
  Effect.gen(function* () {
    const process = yield* PiProcessTag;
    const executable = yield* resolvePiExecutableEffect.pipe(Effect.orDie);
    return yield* cachePiAgentAvailability(makePiAgent(process, { executable }));
  }),
).pipe(Layer.provideMerge(PiProcessLayer), Layer.provideMerge(Infra));

const FileSystemProvided = FileSystemServiceLayer.pipe(Layer.provideMerge(Infra));
const GitProvided = GitServiceLayer.pipe(Layer.provideMerge(FileSystemProvided));
const WorktreeProvided = WorktreeServiceLayer.pipe(Layer.provideMerge(Infra));
const ProjectServiceProvided = ProjectServiceLayer.pipe(
  Layer.provide(ProjectRepositoryLayer),
  Layer.provideMerge(Infra),
);
const PiAgentSessionManagerProvided = PiAgentSessionManagerLayer.pipe(
  Layer.provide(PiAgentProvided),
  Layer.provideMerge(Infra),
);
const PiAgentSessionServiceProvided = PiAgentSessionServiceLayer.pipe(
  Layer.provide(PiAgentSessionManagerProvided),
  Layer.provide(PiAgentProvided),
  Layer.provide(ProjectServiceProvided),
  Layer.provide(WorktreeProvided),
  Layer.provideMerge(Infra),
);
const PiAgentServiceProvided = PiAgentServiceLayer;
const PullRequestServiceProvided = PullRequestServiceLayer.pipe(Layer.provide(NodeProcessLayer));
const ScheduleServiceProvided = ScheduleServiceLayer.pipe(
  Layer.provide(ScheduleRepositoryLayer),
  Layer.provide(ProjectServiceProvided),
  Layer.provide(PiAgentSessionServiceProvided),
  Layer.provideMerge(Infra),
);

const ScheduleDaemonLayer = Layer.effectDiscard(runScheduleLoop.pipe(Effect.forkScoped)).pipe(
  Layer.provide(ScheduleServiceProvided),
);

export const AgentRuntimeLayer = Layer.mergeAll(
  EventBusLayer,
  PiAgentServiceProvided,
  PiAgentSessionServiceProvided,
  ProjectServiceProvided,
  ScheduleServiceProvided,
  ScheduleDaemonLayer,
  PiAgentProvided,
  PiProcessLayer,
  FileSystemProvided,
  GitProvided,
  WorktreeProvided,
  PullRequestServiceProvided,
  PlatformLayer,
  NodeHttpPlatform.layer,
);

// Re-export for tests that cached availability on a shape.
export const cacheAvailability = cachePiAgentAvailability;
