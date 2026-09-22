import * as NodeChildProcessSpawner from "@effect/platform-node/NodeChildProcessSpawner";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodeHttpPlatform from "@effect/platform-node/NodeHttpPlatform";
import * as NodePath from "@effect/platform-node/NodePath";
import { Effect, Layer } from "effect";
import { ChildProcessSpawner } from "effect/unstable/process";

import { PathsLayer } from "../config/paths";
import { EventBusLayer } from "../events";
import { FileSystemServiceLayer } from "../fs";
import { GitServiceLayer, WorktreeServiceLayer } from "../git";
import { PiAgentSessionManagerLayer, PiAgentSessionServiceLayer } from "../harness";
import { cachePiAgentAvailability, makePiAgent, PiAgent } from "../harness/pi/agent";
import { makePiProcess, PiProcessTag } from "../harness/pi/process";
import { resolvePiExecutable } from "../harness/pi/resolve-executable";
import { ResourceMonitoring } from "../observability/resources";
import { PackageServiceLayer } from "../packages";
import { ProjectRepositoryLayer, ProjectServiceLayer } from "../project";
import { PullRequestServiceLayer } from "../pull-request";
import { runScheduleLoop, ScheduleRepositoryLayer, ScheduleServiceLayer } from "../schedule";
import { SettingsRepositoryLayer } from "../settings";
import { SkillServiceLayer } from "../skills";
import { TerminalManagerLayer } from "../terminal";

export { PiProcessTag };

const PlatformLayer = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer, NodeCrypto.layer);

const NodeProcessLayer = NodeChildProcessSpawner.layer.pipe(Layer.provide(PlatformLayer));

const piExecutable = resolvePiExecutable();
const piProcessOptions = { executable: piExecutable };

export const PiProcessLayer: Layer.Layer<
  PiProcessTag,
  never,
  ResourceMonitoring | ChildProcessSpawner.ChildProcessSpawner
> = Layer.effect(
  PiProcessTag,
  Effect.gen(function* () {
    const resources = yield* ResourceMonitoring;
    return yield* makePiProcess({
      ...piProcessOptions,
      onSpawn: (sessionId, pid) => resources.registerPi(sessionId, { pid }),
      onExit: (sessionId, pid) => resources.unregisterPi(sessionId, { pid }),
    });
  }),
);

const PiAgentLayer = Layer.effect(
  PiAgent,
  Effect.gen(function* () {
    const process = yield* PiProcessTag;
    return yield* cachePiAgentAvailability(makePiAgent(process, piProcessOptions));
  }),
);

const ScheduleDaemonLayer = Layer.effectDiscard(runScheduleLoop.pipe(Effect.forkScoped)).pipe(
  Layer.provide(ScheduleServiceLayer),
);

/**
 * One reference per shared layer. `mergeAll` does not wire siblings, so each
 * dependency is `provide`d again with that same reference — Effect memoizes
 * layers by identity, and a second reference would split EventBus, Pi, and
 * the schedule daemon from the services RPC calls.
 *
 * Platform services are provided only here. `ResourceMonitoring` stays in `R`
 * so `createRpcRuntime` can supply the process monitor.
 */
export const AgentRuntimeLayer = Layer.mergeAll(
  EventBusLayer,
  PiAgentSessionServiceLayer,
  ProjectServiceLayer,
  SettingsRepositoryLayer,
  ScheduleServiceLayer,
  ScheduleDaemonLayer,
  PackageServiceLayer,
  SkillServiceLayer,
  PiAgentLayer,
  PiProcessLayer,
  FileSystemServiceLayer,
  GitServiceLayer,
  WorktreeServiceLayer,
  PullRequestServiceLayer,
  TerminalManagerLayer,
  PlatformLayer,
  NodeHttpPlatform.layer,
).pipe(
  Layer.provide(ScheduleServiceLayer),
  Layer.provide(PiAgentSessionServiceLayer),
  Layer.provide(ProjectServiceLayer),
  Layer.provide(WorktreeServiceLayer),
  Layer.provide(PiAgentSessionManagerLayer),
  Layer.provide(PiAgentLayer),
  Layer.provide(PiProcessLayer),
  Layer.provide(EventBusLayer),
  Layer.provide(FileSystemServiceLayer),
  Layer.provide(ProjectRepositoryLayer),
  Layer.provide(ScheduleRepositoryLayer),
  Layer.provide(PathsLayer),
  Layer.provide(PlatformLayer),
  Layer.provide(NodeProcessLayer),
);
