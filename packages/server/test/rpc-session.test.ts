import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { createRouterClient } from "@orpc/server";
import { Effect, Layer, ManagedRuntime } from "effect";
import { describe, expect, it } from "vitest";

import { layerPaths } from "../src/config/paths";
import { EventBusLayer } from "../src/events";
import { FileSystemServiceLayer } from "../src/fs";
import {
  HarnessAgentServiceLayer,
  HarnessAgentSessionManagerLayer,
  HarnessAgentSessionServiceLayer,
} from "../src/harness";
import { makePiAdapter, makePiAgent } from "../src/harness/pi";
import { PiAdapter } from "../src/harness/pi-adapter";
import * as Observability from "../src/observability";
import { ProjectRepositoryLayer, ProjectServiceLayer } from "../src/project";
import type { RpcContext } from "../src/rpc/context";
import { router } from "../src/rpc/router";
import { Pi } from "../src/rpc/runtime";

const FAKE = `#!/usr/bin/env node
const readline = require("node:readline");
const rl = readline.createInterface({ input: process.stdin });
const send = (f) => process.stdout.write(JSON.stringify(f) + "\\n");
const sidIndex = process.argv.indexOf("--session-id");
const sessionId = sidIndex === -1 ? "default-sid" : process.argv[sidIndex + 1];
process.stdout.write("pi startup banner (not json)\\n");
send({ type: "extension_ui_request", id: "st", method: "setStatus", statusKey: "k", statusText: "v" });
const assistant = (over = {}) => ({ role: "assistant", content: [], api: "a", provider: "p", model: "m1", usage: { input: 1, output: 2 }, stopReason: "stop", timestamp: 0, ...over });
const upd = (ev) => send({ type: "message_update", message: assistant(), assistantMessageEvent: ev });
const settle = (last) => { send({ type: "agent_end", messages: [last || assistant()], willRetry: false }); send({ type: "agent_settled" }); };
rl.on("line", (line) => {
  const msg = JSON.parse(line);
  if (msg.type === "get_state") { send({ id: msg.id, type: "response", command: "get_state", success: true, data: { sessionId } }); return; }
  if (msg.type !== "prompt") return;
  send({ id: msg.id, type: "response", command: "prompt", success: true });
  send({ type: "agent_start" });
  upd({ type: "start" });
  upd({ type: "text_start", contentIndex: 0 });
  upd({ type: "text_delta", contentIndex: 0, delta: "pong" });
  upd({ type: "text_end", contentIndex: 0, content: "pong" });
  send({ type: "message_end", message: assistant() });
  settle();
});
`;

function makeFake(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fake-pi-rpc-"));
  const file = path.join(dir, "fake-pi.js");
  fs.writeFileSync(file, FAKE);
  fs.chmodSync(file, 0o755);
  return file;
}

async function setup() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "pie-home-"));
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "pie-ws-"));
  const pathsLayer = Layer.provideMerge(layerPaths(home), NodeServices.layer);

  const piExecutable = { command: makeFake(), prefixArgs: [] as const };
  const piLayer = Layer.effect(Pi, makePiAgent({ executable: piExecutable })).pipe(
    Layer.provide(NodeServices.layer),
  );
  const piAdapterLayer = Layer.effect(
    PiAdapter,
    Effect.gen(function* () {
      const pi = yield* Pi;
      return makePiAdapter(pi, { executable: piExecutable });
    }),
  ).pipe(Layer.provide(piLayer));

  const harnessSessionLayer = HarnessAgentSessionServiceLayer.pipe(
    Layer.provide(
      HarnessAgentSessionManagerLayer.pipe(
        Layer.provide(piAdapterLayer),
        Layer.provide(EventBusLayer),
        Layer.provide(NodeServices.layer),
      ),
    ),
    Layer.provide(piAdapterLayer),
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
    HarnessAgentServiceLayer,
    harnessSessionLayer,
    projectServiceLayer,
    piAdapterLayer,
    FileSystemServiceLayer.pipe(Layer.provide(NodeServices.layer)),
    NodeServices.layer,
    Observability.discard,
  );
  const runtime = ManagedRuntime.make(appLayer);
  const context: RpcContext = {
    "effect/context": await runtime.runPromise(runtime.contextEffect),
  };
  const client = createRouterClient(router, { context });
  return { client, workspace, dispose: () => runtime.dispose() };
}

describe("agent.session router", () => {
  it("creates a session from a project and streams its scoped events", async () => {
    const { client, workspace, dispose } = await setup();
    try {
      const project = await client.project.create({ path: workspace });
      const ref = await client.agent.session.create({
        projectId: project.id,
      });
      expect(ref.projectId).toBe(project.id);

      const events = await client.agent.session.subscribe({ scope: { kind: "session", ref } });
      const receipt = await client.agent.session.prompt({
        ref,
        parts: [{ type: "text", text: "ping" }],
      });
      expect(receipt.turnId).toBeDefined();

      const chunks: { type: string }[] = [];
      for await (const item of events) {
        if (item.type !== "event") continue;
        const event = item.event;
        if (event.type === "session.message.chunk") chunks.push(event.chunk);
        if (event.type === "session.turn.ended" && event.turnId === receipt.turnId) break;
      }
      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks.at(-1)?.type).toBe("finish");

      const snapshot = await client.agent.session.getSnapshot({ ref });
      expect(snapshot.cursor).toBeGreaterThan(0);
      await client.agent.session.close({ ref });
    } finally {
      await dispose();
    }
  });

  it("answers for a closed session over the wire instead of SESSION_NOT_ACTIVE", async () => {
    const { client, workspace, dispose } = await setup();
    try {
      const project = await client.project.create({ path: workspace });
      const ref = await client.agent.session.create({ projectId: project.id });
      await client.agent.session.close({ ref });

      const prepared = await client.agent.session.prepare({ ref });
      const status = await client.agent.session.getStatus({ ref });
      const snapshot = await client.agent.session.getSnapshot({ ref });

      expect(prepared).toEqual(ref);
      expect(status).toEqual({ phase: "idle" });
      expect(snapshot.cursor).toBe(0);
      expect(snapshot.activeTurn).toBeNull();
    } finally {
      await dispose();
    }
  });

  it("lists, renames, archives, restores, and deletes sessions", async () => {
    const { client, workspace, dispose } = await setup();
    try {
      const project = await client.project.create({ path: workspace });
      const ref = await client.agent.session.create({ projectId: project.id });

      const active = await client.agent.session.list({ projectId: project.id });
      expect(active).toHaveLength(1);
      expect(active[0]?.sessionId).toBe(ref.sessionId);
      expect(active[0]?.status?.phase).toBeDefined();
      expect(active[0]?.archived).toBe(false);

      await client.agent.session.rename({ ref, title: "Login bug" });
      const renamed = await client.agent.session.list({ projectId: project.id });
      expect(renamed[0]?.title).toBe("Login bug");

      await client.agent.session.archive({ ref, archived: true });
      const archived = await client.agent.session.list({ projectId: project.id, archived: true });
      expect(archived[0]?.archived).toBe(true);
      expect(await client.agent.session.list({ projectId: project.id, archived: false })).toEqual([]);

      await client.agent.session.archive({ ref, archived: false });
      const restored = await client.agent.session.list({ projectId: project.id, archived: false });
      expect(restored[0]?.archived).toBe(false);
      expect(await client.agent.session.list({ projectId: project.id, archived: true })).toEqual([]);

      await client.agent.session.close({ ref });
      const idle = await client.agent.session.list({ projectId: project.id, archived: false });
      expect(idle).toHaveLength(1);
      expect(idle[0]?.status).toBeUndefined();

      await client.agent.session.delete({ ref });
      const empty = await client.agent.session.list({ projectId: project.id, archived: false });
      expect(empty).toHaveLength(0);
    } finally {
      await dispose();
    }
  });

  it("announces a rename on the global firehose, carrying the new title", async () => {
    const { client, workspace, dispose } = await setup();
    try {
      const project = await client.project.create({ path: workspace });
      const ref = await client.agent.session.create({ projectId: project.id });

      const observer = await client.agent.session.subscribe({ scope: { kind: "global" } });
      await client.agent.session.rename({ ref, title: "Login bug" });

      let announced: string | undefined;
      for await (const item of observer) {
        if (item.type !== "event") continue;
        if (item.event.type === "session.renamed") {
          announced = item.event.title;
          break;
        }
      }
      expect(announced).toBe("Login bug");
    } finally {
      await dispose();
    }
  });
});
