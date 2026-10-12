import crypto from "node:crypto";
import http from "node:http";

import {
  HUB_CLOSE_REVOKED,
  HUB_PROTOCOL_VERSION,
  HubDaemonFrameSchema,
  HubHelloFrameSchema,
  type HubEvent,
} from "@getpie/contract/hub";
import { Exit, Schema } from "effect";
import { WebSocketServer, type RawData, type WebSocket } from "ws";

import type { HubStore } from "./store";

/** Hub's HTTP and WebSocket host (docs/rfc/pie-hub.md, sections 3, 5 and 6). TLS is the proxy's job. */

export const DEFAULT_MAX_EVENT_BYTES = 1024 * 1024;
const HELLO_MAX_BYTES = 64 * 1024;
const HELLO_DEADLINE_MS = 10_000;
const MAX_PENDING_UPGRADES = 32;
const CLOSE_ALREADY_CONNECTED = 4409;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EVENT_ID = /^[A-Za-z0-9_.-]{1,128}$/;

export interface HubOptions {
  readonly store: HubStore;
  /** Authenticates Hub's own API. Compared in constant time. */
  readonly hubToken: string;
  readonly maxEventBytes?: number;
  readonly now?: () => number;
  /** Ping interval; also the retry check for unacked events. */
  readonly heartbeatMs?: number;
  /** Resend an unacked event after this long. */
  readonly retryMs?: number;
}

export interface RunningHub {
  readonly port: number;
  close(): Promise<void>;
}

interface Connection {
  readonly ws: WebSocket;
  readonly environmentId: string;
  readonly inflight: Map<string, number>;
  missedPongs: number;
}

const sha256 = (value: string) => crypto.createHash("sha256").update(value).digest();
const safeEqual = (a: string, b: string) => crypto.timingSafeEqual(sha256(a), sha256(b));

const rawText = (data: RawData): string => {
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  return (data instanceof ArrayBuffer ? Buffer.from(data) : data).toString("utf8");
};

const decode = <A, I>(schema: Schema.Codec<A, I>, value: unknown): A | undefined => {
  const exit = Schema.decodeUnknownExit(schema)(value);
  return Exit.isSuccess(exit) ? exit.value : undefined;
};

class BodyTooLargeError extends Error {
  override name = "BodyTooLargeError";
}

const readBody = (req: http.IncomingMessage, limit: number): Promise<string> =>
  new Promise((resolve, reject) => {
    const declared = Number(req.headers["content-length"] ?? 0);
    if (declared > limit) {
      reject(new BodyTooLargeError());
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        reject(new BodyTooLargeError());
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });

export function startHub(
  options: HubOptions,
  listen: { port: number; host?: string },
): Promise<RunningHub> {
  const { store, hubToken } = options;
  const maxEventBytes = options.maxEventBytes ?? DEFAULT_MAX_EVENT_BYTES;
  const now = options.now ?? Date.now;
  const heartbeatMs = options.heartbeatMs ?? 30_000;
  const retryMs = options.retryMs ?? 30_000;
  const connections = new Map<string, Connection>();
  const sockets = new Set<WebSocket>();
  let pendingUpgrades = 0;

  const send = (ws: WebSocket, frame: unknown) => ws.send(JSON.stringify(frame));

  const flush = (conn: Connection) => {
    const t = now();
    for (const held of store.pending(conn.environmentId, 100)) {
      const sentAt = conn.inflight.get(held.eventId);
      if (sentAt !== undefined && t - sentAt < retryMs) continue;
      const attempt = store.recordAttempt(held.eventId);
      if (attempt === null) continue;
      conn.inflight.set(held.eventId, t);
      const separator = held.eventId.indexOf(":");
      const event: HubEvent = {
        version: HUB_PROTOCOL_VERSION,
        eventId: held.eventId,
        source: held.eventId.slice(0, separator),
        type: held.type,
        receivedAt: new Date(held.receivedAt).toISOString(),
        expiresAt: new Date(held.expiresAt).toISOString(),
        payload: JSON.parse(held.payload),
      };
      send(conn.ws, { type: "hub.event.deliver", event, deliveryAttempt: attempt });
    }
  };

  const reply = (res: http.ServerResponse, status: number, body?: unknown) => {
    res.writeHead(status, body === undefined ? {} : { "content-type": "application/json" });
    res.end(body === undefined ? undefined : JSON.stringify(body));
  };

  const handle = async (req: http.IncomingMessage, res: http.ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://hub");
    const route = `${req.method} ${url.pathname}`;
    if (route === "GET /healthz") return reply(res, 200, { ok: true });

    const bearer = /^Bearer (.+)$/.exec(req.headers.authorization ?? "")?.[1];
    if (bearer === undefined || !safeEqual(bearer, hubToken)) {
      return reply(res, 401, { error: "unauthorized" });
    }

    if (route === "POST /enrollment-tokens") {
      const token = crypto.randomBytes(32).toString("base64url");
      const t = now();
      if (!store.mintEnrollmentToken(sha256(token), t))
        return reply(res, 429, { error: "too_many_tokens" });
      return reply(res, 201, { token });
    }

    if (route === "POST /events") {
      let body: unknown;
      try {
        body = JSON.parse(await readBody(req, maxEventBytes));
      } catch (error) {
        return error instanceof BodyTooLargeError
          ? reply(res, 413, { error: "payload_too_large" })
          : reply(res, 400, { error: "invalid_json" });
      }
      const input = decode(
        Schema.Struct({
          environmentId: Schema.String.check(Schema.isPattern(UUID)),
          type: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
          id: Schema.optionalKey(Schema.String.check(Schema.isPattern(EVENT_ID))),
          payload: Schema.Unknown,
        }),
        body,
      );
      if (!input) return reply(res, 400, { error: "invalid_event" });
      const eventId = `api:${input.id ?? crypto.randomUUID()}`;
      const result = store.insertEvent({
        eventId,
        environmentId: input.environmentId,
        type: input.type,
        payload: JSON.stringify(input.payload ?? null),
        now: now(),
        connected: connections.has(input.environmentId),
      });
      if (result.kind === "unknown_environment")
        return reply(res, 404, { error: "unknown_environment" });
      if (result.kind === "duplicate") return reply(res, 200, { eventId, outcome: "duplicate" });
      const conn = connections.get(input.environmentId);
      if (result.outcome === null && conn) flush(conn);
      return reply(res, 202, { eventId, outcome: result.outcome ?? "pending" });
    }

    const revoke = /^DELETE \/environments\/([^/]+)$/.exec(route)?.[1];
    if (revoke !== undefined) {
      if (!UUID.test(revoke)) return reply(res, 400, { error: "invalid_environment" });
      // Persist the revocation before any socket closes.
      if (!store.revoke(revoke)) return reply(res, 404, { error: "unknown_environment" });
      connections.get(revoke)?.ws.close(HUB_CLOSE_REVOKED, "revoked");
      return reply(res, 204);
    }

    return reply(res, 404, { error: "not_found" });
  };

  const server = http.createServer((req, res) => {
    handle(req, res).catch(() => {
      if (!res.headersSent) reply(res, 500, { error: "internal" });
      else res.destroy();
    });
  });
  server.headersTimeout = 10_000;
  server.requestTimeout = 10_000;

  const wss = new WebSocketServer({ noServer: true, maxPayload: HELLO_MAX_BYTES });

  server.on("upgrade", (req, socket, head) => {
    const token = /^Bearer (.+)$/.exec(req.headers.authorization ?? "")?.[1];
    if (new URL(req.url ?? "/", "http://hub").pathname !== "/daemon" || token === undefined) {
      socket.destroy();
      return;
    }
    if (pendingUpgrades >= MAX_PENDING_UPGRADES) {
      socket.end("HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n");
      return;
    }
    pendingUpgrades++;
    wss.handleUpgrade(req, socket, head, (ws) => {
      sockets.add(ws);
      ws.on("close", () => sockets.delete(ws));
      onSocket(ws, token);
    });
  });

  const onSocket = (ws: WebSocket, token: string) => {
    let conn: Connection | undefined;
    let settled = false;
    const settle = () => {
      if (!settled) {
        settled = true;
        pendingUpgrades--;
      }
    };
    const deadline = setTimeout(() => ws.close(1008, "hello timeout"), HELLO_DEADLINE_MS);
    ws.on("close", () => {
      clearTimeout(deadline);
      settle();
      if (conn && connections.get(conn.environmentId) === conn)
        connections.delete(conn.environmentId);
    });
    ws.on("error", () => ws.terminate());

    ws.on("message", (data, isBinary) => {
      if (isBinary) return ws.close(1003, "text only");
      let json: unknown;
      try {
        json = JSON.parse(rawText(data));
      } catch {
        return ws.close(1007, "invalid json");
      }

      if (!conn) {
        const hello = decode(HubHelloFrameSchema, json);
        if (!hello || hello.protocol !== HUB_PROTOCOL_VERSION)
          return ws.close(1002, "invalid hello");
        const hash = sha256(token);
        const known = store.authenticate(hello.environmentId, hash);
        const enrolled = known ? "known" : store.enroll(hash, hello.environmentId, now());
        if (enrolled === "invalid_token" || enrolled === "conflict") {
          return ws.close(HUB_CLOSE_REVOKED, "rejected");
        }
        if (connections.has(hello.environmentId))
          return ws.close(CLOSE_ALREADY_CONNECTED, "already connected");
        clearTimeout(deadline);
        settle();
        conn = { ws, environmentId: hello.environmentId, inflight: new Map(), missedPongs: 0 };
        connections.set(hello.environmentId, conn);
        send(ws, { type: "hub.welcome", protocol: HUB_PROTOCOL_VERSION });
        flush(conn);
        return;
      }

      const frame = decode(HubDaemonFrameSchema, json);
      if (!frame || frame.type === "hub.hello") return ws.close(1002, "invalid frame");
      if (frame.type === "hub.pong") conn.missedPongs = 0;
      else if (frame.type === "hub.event.ack") {
        conn.inflight.delete(frame.eventId);
        store.ack(frame.eventId, conn.environmentId, frame.status);
      }
    });
  };

  const timer = setInterval(() => {
    store.sweep(now());
    for (const conn of connections.values()) {
      if (conn.missedPongs >= 2) {
        conn.ws.terminate();
        continue;
      }
      conn.missedPongs++;
      send(conn.ws, { type: "hub.ping" });
      flush(conn);
    }
  }, heartbeatMs);
  timer.unref();

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(listen.port, listen.host, () => {
      const address = server.address();
      resolve({
        port: typeof address === "object" && address ? address.port : listen.port,
        close: () =>
          new Promise<void>((_resolve) => {
            clearInterval(timer);
            for (const ws of sockets) ws.terminate();
            server.close(() => {
              _resolve();
            });
            server.closeAllConnections();
          }),
      });
    });
  });
}
