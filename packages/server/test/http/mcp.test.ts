import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createPieClient } from "@getpie/client";
import { Schema } from "effect";
import { afterEach, describe, expect, it } from "vitest";

import { deriveMcpToken, MCP_PATH } from "../../src/http/mcp";
import type { ManagedServer } from "../../src/http/server";
import { issueAgentMcpToken, revokeAgentMcpToken, setAgentMcpEndpoint } from "../../src/pi/pie-mcp";
import { discardContext } from "../platform";

const TOKEN = "test-token-mcp";
const someSession = { projectId: "project-x", sessionId: "session-x" };
const ToolList = Schema.Struct({
  tools: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      inputSchema: Schema.Struct({
        properties: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
        required: Schema.optionalKey(Schema.Array(Schema.String)),
      }),
    }),
  ),
});
const Ticket = Schema.Struct({ ticket: Schema.String });
const Sessions = Schema.Array(Schema.Struct({ sessionId: Schema.String }));

const FAKE = `#!/usr/bin/env node
const readline = require("node:readline");
const rl = readline.createInterface({ input: process.stdin });
const send = (f) => process.stdout.write(JSON.stringify(f) + "\\n");
const sidIndex = process.argv.indexOf("--session-id");
const sessionId = sidIndex === -1 ? "default-sid" : process.argv[sidIndex + 1];
if (process.env.FAKE_TOKEN_DIR && process.env.PIE_MCP_TOKEN) {
  require("node:fs").writeFileSync(require("node:path").join(process.env.FAKE_TOKEN_DIR, String(process.pid)), process.env.PIE_MCP_TOKEN);
}
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
    const agentToken = issueAgentMcpToken(someSession);
    const accepted = await post({ authorization: `Bearer ${agentToken}` }, ping);
    expect(accepted.status).toBe(200);
    // A process token opens /mcp and nothing else.
    const api = await fetch(`${base}/api/ws-ticket`, {
      method: "POST",
      headers: { authorization: `Bearer ${agentToken}` },
    });
    expect(api.status).toBe(401);
    revokeAgentMcpToken(agentToken);
    const revoked = await post({ authorization: `Bearer ${agentToken}` }, ping);
    expect(revoked.status).toBe(401);

    const init = await rpc("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "t", version: "0" },
    });
    expect(init.protocolVersion).toBe("2025-06-18");
    const { tools } = Schema.decodeUnknownSync(ToolList)(await rpc("tools/list"));
    const names = tools.map((tool) => tool.name);
    // A model only sees this schema; without it every call is a guess.
    const inputs = Object.fromEntries(
      tools.map((tool) => [tool.name, Object.keys(tool.inputSchema.properties ?? {})]),
    );
    expect(inputs.session_ls).toEqual(expect.arrayContaining(["projectId"]));
    expect(inputs.session_rename).toEqual(expect.arrayContaining(["ref", "title"]));
    expect(inputs.session_send).toEqual(expect.arrayContaining(["ref", "parts"]));
    expect(inputs.pr_link).toEqual(expect.arrayContaining(["ref", "pullRequest"]));
    const noInput = new Set(["project_ls", "schedule_list"]);
    expect(names.filter((name) => !noInput.has(name) && inputs[name]?.length === 0)).toEqual([]);
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

  it("under pie serve (no daemon token) accepts only a per-process token", async () => {
    process.env.PIE_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "pie-home-mcp-serve-"));
    const { createServer } = await import("../../src/http/server");
    const started = await createServer({
      shutdown: () => {},
      effectContext: await discardContext(),
    });
    server = started;
    await new Promise<void>((resolve) => {
      started.listen(0, "127.0.0.1", resolve);
    });
    const address = started.address();
    if (address === null || typeof address === "string") throw new Error("no TCP address");
    const post = (headers: Record<string, string>) =>
      fetch(`http://127.0.0.1:${address.port}${MCP_PATH}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          ...headers,
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
      });
    const none = await post({});
    expect(none.status).toBe(401);
    const agentToken = issueAgentMcpToken(someSession);
    const accepted = await post({ authorization: `Bearer ${agentToken}` });
    expect(accepted.status).toBe(200);
    revokeAgentMcpToken(agentToken);
    const revoked = await post({ authorization: `Bearer ${agentToken}` });
    expect(revoked.status).toBe(401);
  });

  const bootBinding = async () => {
    const fakeDir = fs.mkdtempSync(path.join(os.tmpdir(), "fake-pi-mcp-bind-"));
    const fakePi = path.join(fakeDir, "fake-pi.js");
    fs.writeFileSync(fakePi, FAKE);
    fs.chmodSync(fakePi, 0o755);
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "pie-ws-mcp-bind-"));
    process.env.PIE_E2E = "1";
    process.env.PIE_E2E_PI_EXECUTABLE = fakePi;
    process.env.PIE_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "pie-home-mcp-bind-"));

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
    const url = `http://127.0.0.1:${address.port}${MCP_PATH}`;
    const derived = deriveMcpToken(TOKEN);
    const call = async (bearer: string, name: string, args: unknown) => {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          authorization: `Bearer ${bearer}`,
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name, arguments: args },
        }),
      });
      const body = (await response.json()) as {
        result?: { isError?: boolean; content?: Array<{ text?: string }> };
        error?: { message?: string };
      };
      if (body.error !== undefined) return { isError: true, value: body.error.message ?? "" };
      const text = body.result?.content?.[0]?.text ?? "";
      return { isError: body.result?.isError === true, value: text };
    };
    const Statuses = Schema.Array(
      Schema.Struct({
        ref: Schema.Struct({ sessionId: Schema.String }),
        links: Schema.Array(
          Schema.Struct({
            ref: Schema.Struct({ number: Schema.Number }),
            excluded: Schema.Boolean,
          }),
        ),
      }),
    );
    const linksOf = async (ref: { projectId: string; sessionId: string }) => {
      const read = await call(derived, "pr_ls", { refs: [ref] });
      expect(read.isError).toBe(false);
      const [status] = Schema.decodeUnknownSync(Statuses)(JSON.parse(read.value));
      return status?.links ?? [];
    };

    const created = await call(derived, "project_create", { path: workspace });
    const projectId = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.String }))(
      JSON.parse(created.value),
    ).id;
    const Ran = Schema.Struct({
      ref: Schema.Struct({ projectId: Schema.String, sessionId: Schema.String }),
    });
    const refOf = async (prompt: string) =>
      Schema.decodeUnknownSync(Ran)(
        JSON.parse(await valueOf(derived, "session_run", { projectId, prompt })),
      ).ref;
    const pr = (number: number) => ({ host: "github.com", owner: "o", repository: "r", number });
    const valueOf = async (bearer: string, name: string, args: unknown) => {
      const result = await call(bearer, name, args);
      return result.value;
    };
    const fails = async (bearer: string, name: string, args: unknown) => {
      const result = await call(bearer, name, args);
      return result.isError;
    };
    const linkNumbers = async (ref: { projectId: string; sessionId: string }) => {
      const links = await linksOf(ref);
      return links.map((link) => link.ref.number);
    };
    const linkExcluded = async (ref: { projectId: string; sessionId: string }) => {
      const links = await linksOf(ref);
      return links.map((link) => link.excluded);
    };
    return { url, derived, call, valueOf, fails, linkNumbers, linkExcluded, refOf, pr, Statuses };
  };

  it("binds a per-process bearer to its own Session for pr_* and refuses every other", async () => {
    const { url, derived, call, valueOf, fails, linkNumbers, linkExcluded, refOf, pr, Statuses } =
      await bootBinding();
    const a = await refOf("session a");
    const b = await refOf("session b");
    const tokenA = issueAgentMcpToken(a);
    const tokenB = issueAgentMcpToken(b);

    // No ref: lands on the caller's own Session, not any other.
    const linked = await call(tokenA, "pr_link", { pullRequest: pr(7) });
    expect(linked.isError).toBe(false);
    expect(linked.value).toBe("linked");
    await expect(linkNumbers(a)).resolves.toEqual([7]);
    await expect(linkNumbers(b)).resolves.toEqual([]);

    // Naming its own Session is the same thing; naming another is refused and writes nothing.
    await expect(valueOf(tokenA, "pr_link", { ref: a, pullRequest: pr(7) })).resolves.toBe(
      "exists",
    );
    const foreignLink = await call(tokenA, "pr_link", { ref: b, pullRequest: pr(8) });
    expect(foreignLink.isError).toBe(true);
    expect(foreignLink.value).toContain("own session");
    await expect(linkNumbers(b)).resolves.toEqual([]);
    const foreignExclude = await call(tokenA, "pr_exclude", { ref: b, pullRequest: pr(8) });
    expect(foreignExclude.isError).toBe(true);
    await expect(linkNumbers(b)).resolves.toEqual([]);
    await expect(fails(tokenA, "pr_ls", { refs: [b] })).resolves.toBe(true);
    await expect(fails(tokenA, "pr_ls", { refs: [a, b] })).resolves.toBe(true);

    // pr_ls with no refs reads its own Session; another process writes only to its own.
    const own = Schema.decodeUnknownSync(Statuses)(JSON.parse(await valueOf(tokenA, "pr_ls", {})));
    expect(own.map((status) => status.ref.sessionId)).toEqual([a.sessionId]);
    await expect(fails(tokenB, "pr_link", { pullRequest: pr(9) })).resolves.toBe(false);
    await expect(linkNumbers(a)).resolves.toEqual([7]);
    await expect(linkNumbers(b)).resolves.toEqual([9]);

    // Exclusion also defaults to the caller's Session.
    await expect(fails(tokenA, "pr_exclude", { pullRequest: pr(7) })).resolves.toBe(false);
    await expect(linkExcluded(a)).resolves.toEqual([true]);

    // A credential that is not bound must say which Session.
    const unbound = await call(derived, "pr_link", { pullRequest: pr(10) });
    expect(unbound.isError).toBe(true);
    expect(unbound.value).toContain("session ref is required");
    await expect(linkNumbers(a)).resolves.toEqual([7]);

    revokeAgentMcpToken(tokenA);
    revokeAgentMcpToken(tokenB);
    const gone = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${tokenA}`,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
    });
    expect(gone.status).toBe(401);
  });

  it("gives each spawned Pi a bearer bound to the Session it was spawned for", async () => {
    const tokenDir = fs.mkdtempSync(path.join(os.tmpdir(), "pie-mcp-tokens-"));
    process.env.FAKE_TOKEN_DIR = tokenDir;
    const { url, valueOf, fails, linkNumbers, refOf, pr } = await bootBinding();
    setAgentMcpEndpoint(url);
    try {
      const childTokens = () =>
        fs.readdirSync(tokenDir).map((name) => fs.readFileSync(path.join(tokenDir, name), "utf8"));
      const waitForChild = async (count: number) => {
        for (let attempt = 0; attempt < 100 && childTokens().length < count; attempt += 1) {
          await new Promise<void>((resolve) => {
            setTimeout(resolve, 100);
          });
        }
        expect(childTokens()).toHaveLength(count);
      };
      const a = await refOf("child a");
      await waitForChild(1);
      const [tokenA] = childTokens();
      const b = await refOf("child b");
      await waitForChild(2);
      const tokenB = childTokens().find((token) => token !== tokenA);
      if (tokenA === undefined || tokenB === undefined) throw new Error("missing child tokens");

      await expect(valueOf(tokenA, "pr_link", { pullRequest: pr(1) })).resolves.toBe("linked");
      await expect(valueOf(tokenB, "pr_link", { pullRequest: pr(2) })).resolves.toBe("linked");
      await expect(linkNumbers(a)).resolves.toEqual([1]);
      await expect(linkNumbers(b)).resolves.toEqual([2]);
      await expect(fails(tokenA, "pr_link", { ref: b, pullRequest: pr(3) })).resolves.toBe(true);
      await expect(linkNumbers(b)).resolves.toEqual([2]);
    } finally {
      setAgentMcpEndpoint(undefined);
      delete process.env.FAKE_TOKEN_DIR;
    }
  }, 30_000);
});
