import fs from "node:fs";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";

import { createPieClient } from "@getpie/client";
import { afterEach, describe, expect, it } from "vitest";

import { createServer, type ManagedServer } from "../../src/http/server";
import { discardContext } from "../platform";

const TOKEN = "test-token-pairing-prompt";
const ENVIRONMENT_ID = "env-pairing-prompt";

const FAKE = `#!/usr/bin/env node
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

function textFromChunk(chunk: unknown): string {
  if (typeof chunk !== "object" || chunk === null) return "";
  const rec = chunk as { type?: unknown; delta?: unknown };
  if (rec.type === "text-delta" && typeof rec.delta === "string") return rec.delta;
  return "";
}

describe("createServer pairing prompt", () => {
  let server: ManagedServer | undefined;
  const saved = {
    PIE_E2E: process.env.PIE_E2E,
    PIE_E2E_PI_EXECUTABLE: process.env.PIE_E2E_PI_EXECUTABLE,
    PIE_HOME: process.env.PIE_HOME,
  };

  afterEach(async () => {
    await server?.dispose();
    server = undefined;
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("exchanges a pairing session token and prompts through the shipped WebSocket RPC", async () => {
    const fakeDir = fs.mkdtempSync(path.join(os.tmpdir(), "fake-pi-pair-"));
    const fakePi = path.join(fakeDir, "fake-pi.js");
    fs.writeFileSync(fakePi, FAKE);
    fs.chmodSync(fakePi, 0o755);
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "pie-home-pair-"));
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "pie-ws-pair-"));
    process.env.PIE_E2E = "1";
    process.env.PIE_E2E_PI_EXECUTABLE = fakePi;
    process.env.PIE_HOME = home;

    server = await createServer({
      authToken: TOKEN,
      environmentId: ENVIRONMENT_ID,
      shutdown: () => {},
      effectContext: await discardContext(),
    });
    await new Promise<void>((resolve) => {
      server?.listen(0, "127.0.0.1", resolve);
    });
    const { port } = server.address() as AddressInfo;
    const base = `http://127.0.0.1:${port}`;

    const minted = await fetch(`${base}/api/pairing/mint`, {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(minted.status).toBe(200);
    const { code } = (await minted.json()) as { code: string };
    const exchanged = await fetch(`${base}/api/pairing/exchange`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code }),
    });
    expect(exchanged.status).toBe(200);
    const session = (await exchanged.json()) as { token: string; environmentId: string };
    expect(session.token).not.toBe(TOKEN);
    expect(session.environmentId).toBe(ENVIRONMENT_ID);

    const client = createPieClient({
      url: `ws://127.0.0.1:${port}/ws/rpc`,
      getTicket: async () => {
        const ticket = await fetch(`${base}/api/ws-ticket`, {
          method: "POST",
          headers: { authorization: `Bearer ${session.token}` },
        });
        expect(ticket.status).toBe(200);
        const body = (await ticket.json()) as { ticket: string };
        return body.ticket;
      },
    });

    const project = await client.project.create({ path: workspace });
    const created = await client.agent.session.create({ projectId: project.id });
    const events = await client.agent.session.subscribe({
      scope: { kind: "session", ref: created.ref },
    });
    const receipt = await client.agent.session.prompt({
      ref: created.ref,
      parts: [{ type: "text", text: "ping" }],
    });
    expect(receipt.started).toBe(true);

    let streamed = "";
    let ended = false;
    const deadline = Date.now() + 15_000;
    for await (const item of events) {
      if (Date.now() > deadline) break;
      if (item.type === "closed") break;
      const event = item.event;
      if (event.type === "session.message.chunk") streamed += textFromChunk(event.chunk);
      if (event.type === "session.turn.ended") {
        ended = true;
        break;
      }
    }
    expect(ended).toBe(true);
    expect(streamed).toContain("pong");
    await client.agent.session.close({ ref: created.ref });
  });
});
