import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createPieClient } from "@getpie/client";
import { Schema } from "effect";
import { afterEach, describe, expect, it } from "vitest";

import { deriveMcpToken, MCP_PATH } from "../../src/http/mcp";
import type { ManagedServer } from "../../src/http/server";
import { issueAgentMcpToken, revokeAgentMcpToken } from "../../src/pi/pie-mcp";
import { discardContext } from "../platform";

const TOKEN = "test-token-mcp";
const ToolList = Schema.Struct({ tools: Schema.Array(Schema.Struct({ name: Schema.String })) });
const Ticket = Schema.Struct({ ticket: Schema.String });
const Sessions = Schema.Array(Schema.Struct({ sessionId: Schema.String }));

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
  send({ id: msg.id, type: "response", command: "prompt", success: true, data: { started: true } });
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

describe("external MCP door", () => {
  let server: ManagedServer | undefined;
  const saved = {
    PIE_E2E: process.env.PIE_E2E,
    PIE_E2E_PI_EXECUTABLE: process.env.PIE_E2E_PI_EXECUTABLE,
    PIE_HOME: process.env.PIE_HOME,
  };

  afterEach(async () => {
    await server?.dispose();
    server = undefined;
    if (saved.PIE_E2E === undefined) delete process.env.PIE_E2E;
    else process.env.PIE_E2E = saved.PIE_E2E;
    if (saved.PIE_E2E_PI_EXECUTABLE === undefined) delete process.env.PIE_E2E_PI_EXECUTABLE;
    else process.env.PIE_E2E_PI_EXECUTABLE = saved.PIE_E2E_PI_EXECUTABLE;
    if (saved.PIE_HOME === undefined) delete process.env.PIE_HOME;
    else process.env.PIE_HOME = saved.PIE_HOME;
  });

  it("serves the tools to its own credential, scopes sessions to what it created, and nothing else", async () => {
    const fakeDir = fs.mkdtempSync(path.join(os.tmpdir(), "fake-pi-mcp-"));
    const fakePi = path.join(fakeDir, "fake-pi.js");
    fs.writeFileSync(fakePi, FAKE);
    fs.chmodSync(fakePi, 0o755);
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "pie-ws-mcp-"));
    process.env.PIE_E2E = "1";
    process.env.PIE_E2E_PI_EXECUTABLE = fakePi;
    process.env.PIE_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "pie-home-mcp-"));

    const { createServer } = await import("../../src/http/server");
    const started = await createServer({
      authToken: TOKEN,
      shutdown: () => {},
      effectContext: await discardContext(),
    });
    server = started;
    await new Promise<void>((resolve) => {
      started.listen(0, "127.0.0.1", resolve);
    });
    const address = started.address();
    if (address === null || typeof address === "string") throw new Error("no TCP address");
    const base = `http://127.0.0.1:${address.port}`;
    const mcpToken = deriveMcpToken(TOKEN);
    expect(mcpToken).not.toBe(TOKEN);

    const post = (headers: Record<string, string>, body: unknown) =>
      fetch(`${base}${MCP_PATH}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          ...headers,
        },
        body: JSON.stringify(body),
      });
    const authorized = { authorization: `Bearer ${mcpToken}` };
    const rpc = async (method: string, params?: unknown): Promise<Record<string, unknown>> => {
      const response = await post(authorized, { jsonrpc: "2.0", id: 1, method, params });
      const body: unknown = await response.json();
      if (
        response.status !== 200 ||
        typeof body !== "object" ||
        body === null ||
        !("result" in body)
      ) {
        throw new Error(`${method} ${response.status} ${JSON.stringify(body)}`);
      }
      return (body as { result: Record<string, unknown> }).result;
    };
    const call = async (name: string, args: unknown) => {
      const response = await post(authorized, {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name, arguments: args },
      });
      const body = (await response.json()) as {
        result?: { isError?: boolean; content?: Array<{ text?: string }> };
        error?: { message?: string };
      };
      if (body.error !== undefined) return { isError: true, text: body.error.message ?? "" };
      return {
        isError: body.result?.isError === true,
        text: body.result?.content?.[0]?.text ?? "",
      };
    };

    // Credential boundary: neither a missing token, the daemon token, nor a browser reaches it.
    const ping = { jsonrpc: "2.0", id: 1, method: "ping" };
    const refused = [
      await post({}, ping),
      await post({ authorization: `Bearer ${TOKEN}` }, ping),
      await post({ ...authorized, origin: "https://evil.example" }, ping),
      await fetch(`${base}${MCP_PATH}`, { headers: authorized }),
      await fetch(`${base}/api/ws-ticket`, { method: "POST", headers: authorized }),
    ];
    expect(refused.map((response) => response.status)).toEqual([401, 401, 403, 405, 401]);
    const agentToken = issueAgentMcpToken();
    const accepted = await post({ authorization: `Bearer ${agentToken}` }, ping);
    expect(accepted.status).toBe(200);
    revokeAgentMcpToken(agentToken);
    const revoked = await post({ authorization: `Bearer ${agentToken}` }, ping);
    expect(revoked.status).toBe(401);

    const init = await rpc("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "t", version: "0" },
    });
    expect(init.protocolVersion).toBe("2025-06-18");
    const names = Schema.decodeUnknownSync(ToolList)(await rpc("tools/list")).tools.map(
      (tool) => tool.name,
    );
    expect(names).toEqual(
      expect.arrayContaining([
        "session_ls",
        "session_run",
        "session_wait",
        "pr_link",
        "schedule_run",
        "project_create",
      ]),
    );
    expect(names.filter((name) => /respond|approve/.test(name))).toEqual([]);
    expect(names).not.toContain("session_delete");

    const client = createPieClient({
      url: `ws://127.0.0.1:${address.port}/ws/rpc`,
      getTicket: async () => {
        const ticket = await fetch(`${base}/api/ws-ticket`, {
          method: "POST",
          headers: { authorization: `Bearer ${TOKEN}` },
        });
        return Schema.decodeUnknownSync(Ticket)(await ticket.json()).ticket;
      },
    });
    const project = await client.project.create({ path: workspace });
    const human = await client.session.create({ projectId: project.id });
    const listed = await call("session_ls", { projectId: project.id });
    expect(listed.isError).toBe(false);
    const sessions = Schema.decodeUnknownSync(Sessions)(JSON.parse(listed.text));
    expect(sessions.map((session) => session.sessionId)).toContain(human.ref.sessionId);
    const unknown = await call("no_such_tool", {});
    expect(unknown.isError).toBe(true);

    const modern = async (method: string, params: Record<string, unknown>) => {
      const response = await post(
        {
          ...authorized,
          "mcp-protocol-version": "2026-07-28",
          "mcp-method": method,
          ...(typeof params.name === "string" ? { "mcp-name": params.name } : undefined),
        },
        {
          jsonrpc: "2.0",
          id: 1,
          method,
          params: {
            ...params,
            _meta: {
              "io.modelcontextprotocol/protocolVersion": "2026-07-28",
              "io.modelcontextprotocol/clientCapabilities": {},
            },
          },
        },
      );
      const body: unknown = await response.json();
      if (response.status !== 200 || typeof body !== "object" || body === null) {
        throw new Error(`${method} ${response.status} ${JSON.stringify(body)}`);
      }
      return body as {
        result?: { isError?: boolean; content?: Array<{ text?: string }> };
        error?: { message?: string };
      };
    };
    const missing = await modern("tools/call", {
      name: "session_run",
      arguments: {
        projectId: project.id,
        prompt: "should not create",
        from: { projectId: project.id, sessionId: "missing-session" },
      },
    });
    expect(missing.result?.isError === true || missing.error !== undefined).toBe(true);
    const missList = await call("session_ls", { projectId: project.id });
    const afterMiss = Schema.decodeUnknownSync(Sessions)(JSON.parse(missList.text));
    expect(afterMiss.map((session) => session.sessionId)).toEqual(
      sessions.map((session) => session.sessionId),
    );

    const ranCall = await modern("tools/call", {
      name: "session_run",
      arguments: { projectId: project.id, prompt: "hello from mcp" },
    });
    expect(ranCall.error).toBeUndefined();
    expect(ranCall.result?.isError).not.toBe(true);
    const ran = Schema.decodeUnknownSync(
      Schema.Struct({ ref: Schema.Struct({ sessionId: Schema.String }) }),
    )(JSON.parse(ranCall.result?.content?.[0]?.text ?? ""));
    const runList = await call("session_ls", { projectId: project.id });
    const afterRun = Schema.decodeUnknownSync(Sessions)(JSON.parse(runList.text));
    expect(afterRun.map((session) => session.sessionId)).toContain(ran.ref.sessionId);
  }, 60_000);
});
