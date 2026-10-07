import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";

import { startHub, type HubOptions } from "../src/server";
import { HubStore } from "../src/store";

const HUB_TOKEN = "h".repeat(40);
const ENV = "3f0f2c5e-6b0e-4c53-9c0a-1d2e3f4a5b6c";
const OTHER_ENV = "00000000-0000-4000-8000-000000000000";
const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

type Frame = Record<string, unknown>;

const boot = async (extra: Partial<HubOptions> = {}) => {
  const store = HubStore.open(":memory:");
  const hub = await startHub(
    { store, hubToken: HUB_TOKEN, ...extra },
    { port: 0, host: "127.0.0.1" },
  );
  cleanups.push(() => hub.close());

  const request = async (
    method: string,
    path: string,
    body?: unknown,
    token: string | null = HUB_TOKEN,
  ) => {
    const headers = new Headers({ "content-type": "application/json" });
    if (token) headers.set("authorization", `Bearer ${token}`);
    const res = await fetch(`http://127.0.0.1:${hub.port}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, body: text ? (JSON.parse(text) as Frame) : undefined };
  };
  const statusOf = async (...args: Parameters<typeof request>) => {
    const response = await request(...args);
    return response.status;
  };
  const mint = async () => {
    const { body } = await request("POST", "/enrollment-tokens");
    return String(body?.token);
  };

  /** A daemon-side socket; answers hub.ping so only the tests that want silence get it. */
  const connect = (token: string, options: { hello?: string; answerPings?: boolean } = {}) => {
    const ws = new WebSocket(`ws://127.0.0.1:${hub.port}/daemon`, {
      headers: { authorization: `Bearer ${token}` },
    });
    cleanups.push(() => ws.terminate());
    const frames: Frame[] = [];
    const waiters: Array<() => void> = [];
    ws.on("message", (data) => {
      const frame = JSON.parse(String(Buffer.from(data as Buffer))) as Frame;
      if (frame.type === "hub.ping" && options.answerPings !== false) {
        ws.send(JSON.stringify({ type: "hub.pong" }));
        return;
      }
      frames.push(frame);
      for (const waiter of waiters.splice(0)) waiter();
    });
    const closed = new Promise<number>((resolve) => {
      ws.on("close", (code) => {
        resolve(code);
      });
    });
    ws.on("open", () => {
      ws.send(
        options.hello ?? JSON.stringify({ type: "hub.hello", protocol: 1, environmentId: ENV }),
      );
    });
    const next = async (type: string): Promise<Frame> => {
      for (;;) {
        const index = frames.findIndex((f) => f.type === type);
        if (index !== -1) return frames.splice(index, 1)[0] ?? {};
        await new Promise<void>((resolve) => {
          waiters.push(resolve);
        });
      }
    };
    return { ws, closed, next };
  };
  return { store, request, statusOf, mint, connect, port: hub.port };
};

describe("Hub API", () => {
  it("serves health unauthenticated and rejects other routes without the Hub token", async () => {
    const { statusOf } = await boot();
    await expect(statusOf("GET", "/healthz", undefined, null)).resolves.toBe(200);
    await expect(statusOf("POST", "/enrollment-tokens", undefined, null)).resolves.toBe(401);
    await expect(statusOf("POST", "/enrollment-tokens", undefined, "wrong")).resolves.toBe(401);
    await expect(statusOf("POST", "/events", {}, null)).resolves.toBe(401);
    await expect(statusOf("DELETE", `/environments/${ENV}`, undefined, null)).resolves.toBe(401);
  });

  it("enrolls on first connect, welcomes, and treats the same token as the credential afterwards", async () => {
    const { mint, connect } = await boot();
    const token = await mint();
    const a = connect(token);
    await expect(a.next("hub.welcome")).resolves.toEqual({ type: "hub.welcome", protocol: 1 });
    a.ws.close();
    await a.closed;
    await expect(connect(token).next("hub.welcome")).resolves.toEqual({
      type: "hub.welcome",
      protocol: 1,
    });
  });

  it("refuses an unknown token, a token for an active UUID, and a reused token with 4403", async () => {
    const { mint, connect } = await boot();
    await expect(connect("not-a-real-token").closed).resolves.toBe(4403);
    const token = await mint();
    const a = connect(token);
    await a.next("hub.welcome");
    const second = await mint();
    await expect(connect(second).closed).resolves.toBe(4403);
    a.ws.terminate();
    await a.closed;
    const otherHello = JSON.stringify({ type: "hub.hello", protocol: 1, environmentId: OTHER_ENV });
    await expect(connect(token, { hello: otherHello }).closed).resolves.toBe(4403);
  });

  it("rejects a second live socket for the Environment without revoking it", async () => {
    const { mint, connect } = await boot();
    const token = await mint();
    const a = connect(token);
    await a.next("hub.welcome");
    await expect(connect(token).closed).resolves.toBe(4409);
    expect(a.ws.readyState).toBe(WebSocket.OPEN);
  });

  it("delivers a held event on connect, resends until acked, and records the ack", async () => {
    const { request, mint, connect, store } = await boot({
      heartbeatMs: 20,
      retryMs: 40,
    });
    const token = await mint();
    const first = connect(token);
    await first.next("hub.welcome");
    first.ws.terminate();
    await first.closed;

    const event = {
      environmentId: ENV,
      type: "issue_comment.created",
      id: "d1",
      payload: { n: 1 },
    };
    await expect(request("POST", "/events", event)).resolves.toEqual({
      status: 202,
      body: { eventId: "api:d1", outcome: "pending" },
    });
    await expect(request("POST", "/events", event)).resolves.toEqual({
      status: 200,
      body: { eventId: "api:d1", outcome: "duplicate" },
    });

    const c = connect(token);
    await c.next("hub.welcome");
    const d1 = await c.next("hub.event.deliver");
    expect(d1).toMatchObject({
      deliveryAttempt: 1,
      event: { eventId: "api:d1", source: "api", type: "issue_comment.created", payload: { n: 1 } },
    });
    const d2 = await c.next("hub.event.deliver");
    expect(d2.deliveryAttempt).toBeGreaterThanOrEqual(2);
    c.ws.send(JSON.stringify({ type: "hub.event.ack", eventId: "api:d1", status: "accepted" }));
    await expect.poll(() => store.pending(ENV, 10).length).toBe(0);
  });

  it("pushes an event to a connected daemon immediately", async () => {
    const { request, mint, connect } = await boot();
    const c = connect(await mint());
    await c.next("hub.welcome");
    await request("POST", "/events", { environmentId: ENV, type: "ping", payload: null });
    await expect(c.next("hub.event.deliver")).resolves.toMatchObject({ deliveryAttempt: 1 });
  });

  it("answers 404 for an unknown target and 413 above the size limit, recording nothing", async () => {
    const { request, statusOf, mint, connect, store } = await boot({ maxEventBytes: 100 });
    await expect(
      statusOf("POST", "/events", { environmentId: ENV, type: "x", payload: 1 }),
    ).resolves.toBe(404);
    const c = connect(await mint());
    await c.next("hub.welcome");
    const big = await request("POST", "/events", {
      environmentId: ENV,
      type: "x",
      payload: "y".repeat(500),
    });
    expect(big.status).toBe(413);
    const bad = await request("POST", "/events", { environmentId: "nope", type: "x", payload: 1 });
    expect(bad.status).toBe(400);
    expect(store.pending(ENV, 10)).toEqual([]);
  });

  it("revokes: closes the socket with 4403, then refuses the old credential and events", async () => {
    const { statusOf, mint, connect } = await boot();
    const token = await mint();
    const c = connect(token);
    await c.next("hub.welcome");
    await expect(statusOf("DELETE", `/environments/${ENV}`)).resolves.toBe(204);
    await expect(c.closed).resolves.toBe(4403);
    await expect(statusOf("DELETE", `/environments/${ENV}`)).resolves.toBe(404);
    await expect(connect(token).closed).resolves.toBe(4403);
    await expect(
      statusOf("POST", "/events", { environmentId: ENV, type: "x", payload: 1 }),
    ).resolves.toBe(404);
  });

  it("closes a connection that stops answering pings", async () => {
    const { mint, connect } = await boot({ heartbeatMs: 20 });
    const silent = connect(await mint(), { answerPings: false });
    await silent.next("hub.welcome");
    await expect(silent.closed).resolves.toBeGreaterThanOrEqual(1000);
  });

  it("closes a socket that sends a malformed hello or a wrong protocol", async () => {
    const { mint, connect } = await boot();
    const token = await mint();
    const wrongProtocol = JSON.stringify({ type: "hub.hello", protocol: 2, environmentId: ENV });
    for (const hello of ["{}", "not json", wrongProtocol]) {
      await expect(connect(token, { hello }).closed).resolves.toBeGreaterThanOrEqual(1002);
    }
  });

  it("does not upgrade a request without a bearer token", async () => {
    const { port } = await boot();
    const bare = new WebSocket(`ws://127.0.0.1:${port}/daemon`);
    cleanups.push(() => bare.terminate());
    const error = await new Promise<Error>((resolve) => {
      bare.on("error", resolve);
    });
    expect(error).toBeInstanceOf(Error);
  });
});
