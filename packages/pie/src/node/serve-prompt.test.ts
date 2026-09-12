import childProcess from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import url from "node:url";

import { createPieClient } from "@getpie/client";
import { afterEach, describe, expect, it } from "vitest";

const cliBin = path.join(import.meta.dirname, "../../dist/cli.mjs");

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
  upd({ type: "text_end", contentIndex: 0, content: "pong" });
  upd({ type: "text_delta", contentIndex: 0, delta: "pong" });
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

async function waitForReady(child: childProcess.ChildProcess): Promise<number> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const timer = setTimeout(() => {
      reject(new Error(`pie serve did not start: ${Buffer.concat(chunks).toString("utf8")}`));
    }, 15000);
    const onExit = (code: number | null) => {
      clearTimeout(timer);
      reject(
        new Error(`pie serve exited ${String(code)}: ${Buffer.concat(chunks).toString("utf8")}`),
      );
    };
    const onData = (data: Buffer) => {
      chunks.push(data);
      const text = Buffer.concat(chunks).toString("utf8");
      const match = text.match(/pie:ready \{"port":(\d+)\}/);
      if (match?.[1] !== undefined) {
        clearTimeout(timer);
        child.stdout?.off("data", onData);
        child.off("exit", onExit);
        resolve(Number(match[1]));
      }
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    child.once("exit", onExit);
  });
}

describe("shipped pie serve prompt", () => {
  const children: childProcess.ChildProcess[] = [];

  afterEach(() => {
    for (const child of children) child.kill("SIGTERM");
    children.length = 0;
  });

  it("listModels and pairing prompt work from dist/cli.mjs", async () => {
    const fakeDir = fs.mkdtempSync(path.join(os.tmpdir(), "fake-pi-serve-"));
    const fakePi = path.join(fakeDir, "fake-pi.js");
    fs.writeFileSync(fakePi, FAKE);
    fs.chmodSync(fakePi, 0o755);
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "pie-home-serve-"));
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "pie-ws-serve-"));
    const token = "serve-token-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const child = childProcess.spawn(
      process.execPath,
      [cliBin, "serve", "--port", "0", "--host", "127.0.0.1"],
      {
        env: {
          PATH: process.env.PATH,
          PIE_HOME: home,
          PIE_DAEMON_DIR: path.join(home, "daemon"),
          PIE_AUTH_TOKEN: token,
          PIE_E2E: "1",
          PIE_E2E_PI_EXECUTABLE: fakePi,
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    children.push(child);
    const port = await waitForReady(child);
    const base = `http://127.0.0.1:${String(port)}`;
    const health = await fetch(`${base}/api/health`);
    await expect(health.text()).resolves.toBe("ok");

    const minted = await fetch(`${base}/api/pairing/mint`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
    });
    const { code } = (await minted.json()) as { code: string };
    const exchanged = await fetch(`${base}/api/pairing/exchange`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code }),
    });
    const session = (await exchanged.json()) as { token: string };
    expect(session.token).not.toBe(token);

    const client = createPieClient({
      url: `ws://127.0.0.1:${String(port)}/ws/rpc`,
      getTicket: async () => {
        const ticket = await fetch(`${base}/api/ws-ticket`, {
          method: "POST",
          headers: { authorization: `Bearer ${session.token}` },
        });
        const body = (await ticket.json()) as { ticket: string };
        return body.ticket;
      },
    });

    const models = await client.agent.listModels({});
    expect(models.models.length).toBeGreaterThan(0);

    const project = await client.project.create({ path: workspace });
    const created = await client.agent.session.create({ projectId: project.id });
    const events = await client.agent.session.subscribe({
      scope: { kind: "session", ref: created.ref },
    });
    await client.agent.session.prompt({
      ref: created.ref,
      parts: [{ type: "text", text: "ping" }],
    });
    let streamed = "";
    let ended = false;
    const deadline = Date.now() + 15_000;
    for await (const item of events) {
      if (Date.now() > deadline) break;
      if (item.type === "closed") break;
      if (item.event.type === "session.message.chunk") streamed += textFromChunk(item.event.chunk);
      if (item.event.type === "session.turn.ended") {
        ended = true;
        break;
      }
    }
    expect(ended).toBe(true);
    expect(streamed).toContain("pong");
    await client.agent.session.close({ ref: created.ref });
  });
});
