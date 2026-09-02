import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { createRouterClient } from "@orpc/server";
import { Effect, Layer, ManagedRuntime } from "effect";

import { layerPaths } from "../src/config/paths";
import { EventBusLayer } from "../src/events";
import { FileSystemServiceLayer } from "../src/fs";
import { GitServiceLayer, WorktreeServiceLayer } from "../src/git";
import {
  PiAgentServiceLayer,
  PiAgentSessionManagerLayer,
  PiAgentSessionServiceLayer,
} from "../src/harness";
import { cachePiAgentAvailability, makePiAgent, PiAgent } from "../src/harness/pi/agent";
import { makePiProcess } from "../src/harness/pi/process";
import type { PiExecutable } from "../src/harness/pi/resolve-executable";
import * as Observability from "../src/observability";
import { ProjectRepositoryLayer, ProjectServiceLayer } from "../src/project";
import { PullRequestService, PullRequestServiceLayer } from "../src/pull-request";
import type { RpcContext } from "../src/rpc/context";
import { router } from "../src/rpc/router";
import { PiProcessTag } from "../src/rpc/runtime";
import { ScheduleRepositoryLayer, ScheduleServiceLayer } from "../src/schedule";

const FAKE_PI = `#!/usr/bin/env node
const readline = require("node:readline");
const rl = readline.createInterface({ input: process.stdin });
const send = (f) => process.stdout.write(JSON.stringify(f) + "\\n");
const sidIndex = process.argv.indexOf("--session-id");
const sessionId = sidIndex === -1 ? "default-sid" : process.argv[sidIndex + 1];
process.stdout.write("pi startup banner (not json)\\n");
send({ type: "extension_ui_request", id: "st", method: "setStatus", statusKey: "k", statusText: "v" });
const assistant = (over = {}) => ({ role: "assistant", content: [], api: "a", provider: "p", model: "m1", usage: { input: 1, output: 2 }, stopReason: "stop", timestamp: 0, ...over });
const upd = (ev) => send({ type: "message_update", usage: assistant().usage, assistantMessageEvent: ev });
const settle = (last) => { send({ type: "agent_end", messages: [last || assistant()], willRetry: false }); send({ type: "agent_settled" }); };
rl.on("line", (line) => {
  const msg = JSON.parse(line);
  if (msg.type === "get_state") { send({ id: msg.id, type: "response", command: "get_state", success: true, data: { sessionId } }); return; }
  if (msg.type !== "prompt") return;
  send({ id: msg.id, type: "response", command: "prompt", success: true });
  send({ type: "agent_start" });
  send({ type: "message_start", message: assistant() });
  upd({ type: "start" });
  upd({ type: "text_start", contentIndex: 0 });
  upd({ type: "text_delta", contentIndex: 0, delta: "pong" });
  upd({ type: "text_end", contentIndex: 0, content: "pong" });
  send({ type: "message_end", message: assistant() });
  settle();
});
`;

export function writeFakePiExecutable(): PiExecutable {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fake-pi-"));
  const file = path.join(dir, "fake-pi.js");
  fs.writeFileSync(file, FAKE_PI);
  fs.chmodSync(file, 0o755);
  return { command: file, prefixArgs: [] };
}

export interface RpcTestHarnessOptions {
  readonly executable?: PiExecutable;
  readonly pullRequestLayer?: Layer.Layer<PullRequestService>;
}

export async function makeRpcTestHarness(home: string, options: RpcTestHarnessOptions = {}) {
  const processOptions = options.executable !== undefined ? { executable: options.executable } : {};
  const pathsLayer = Layer.provideMerge(layerPaths(home), NodeServices.layer);
  const piProcessLayer = Layer.effect(PiProcessTag, makePiProcess(processOptions)).pipe(
    Layer.provide(NodeServices.layer),
  );
  const piAgentLayer = Layer.effect(
    PiAgent,
    Effect.gen(function* () {
      const process = yield* PiProcessTag;
      return yield* cachePiAgentAvailability(makePiAgent(process, processOptions));
    }),
  ).pipe(Layer.provide(piProcessLayer), Layer.provide(NodeServices.layer));

  const gitProvided = GitServiceLayer.pipe(
    Layer.provide(FileSystemServiceLayer),
    Layer.provide(NodeServices.layer),
  );
  const worktreeProvided = WorktreeServiceLayer.pipe(
    Layer.provide(pathsLayer),
    Layer.provide(NodeServices.layer),
  );
  const projectServiceLayer = ProjectServiceLayer.pipe(
    Layer.provide(ProjectRepositoryLayer),
    Layer.provide(pathsLayer),
  );
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
    Layer.provide(projectServiceLayer),
    Layer.provide(pathsLayer),
    Layer.provide(worktreeProvided),
    Layer.provide(NodeServices.layer),
  );
  const scheduleServiceLayer = ScheduleServiceLayer.pipe(
    Layer.provide(ScheduleRepositoryLayer),
    Layer.provide(projectServiceLayer),
    Layer.provide(harnessSessionLayer),
    Layer.provide(pathsLayer),
  );
  const pullRequestLayer =
    options.pullRequestLayer ?? PullRequestServiceLayer.pipe(Layer.provide(NodeServices.layer));
  const appLayer = Layer.mergeAll(
    EventBusLayer,
    PiAgentServiceLayer,
    harnessSessionLayer,
    projectServiceLayer,
    scheduleServiceLayer,
    piAgentLayer,
    piProcessLayer,
    FileSystemServiceLayer.pipe(Layer.provide(NodeServices.layer)),
    gitProvided,
    pullRequestLayer,
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
