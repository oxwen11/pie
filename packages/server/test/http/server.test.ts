import http from "node:http";
import type { AddressInfo } from "node:net";

import { Context, Effect, Layer, Logger, Scope } from "effect";
import { HttpServerResponse } from "effect/unstable/http";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";

import { PIE_HTTP_PROTOCOL_VERSION, PIE_PROTOCOL_HEADER } from "../../src/http/protocol";
import { createServer, type ManagedServer } from "../../src/http/server";
import type { UIApp } from "../../src/http/ui";
import type { RpcRuntime } from "../../src/rpc";
import { structured, type LogRecord } from "../log-record";
import { discardContext } from "../platform";

const TOKEN = "test-token-0000";

let server: ManagedServer | undefined;

async function start(options: Parameters<typeof createServer>[0] = {}): Promise<string> {
  server = await createServer({
    ...options,
    effectContext: options.effectContext ?? (await discardContext()),
  });
  await new Promise<void>((resolve) => {
    server?.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

afterEach(async () => {
  await server?.dispose();
  server = undefined;
});

describe("createServer auth", () => {
  it("serves legacy-compatible health with a protocol capability header", async () => {
    const base = await start({ authToken: TOKEN });
    const response = await fetch(`${base}/api/health`);
    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe("ok");
    expect(response.headers.get(PIE_PROTOCOL_HEADER)).toBe(String(PIE_HTTP_PROTOCOL_VERSION));
  });

  it("does not expose an HTTP RPC endpoint", async () => {
    const base = await start({ authToken: TOKEN });
    const response = await fetch(`${base}/api/rpc`, {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(response.status).toBe(404);
  });

  it("rejects a wrong token", async () => {
    const base = await start({ authToken: TOKEN });
    const response = await fetch(`${base}/api/ws-ticket`, {
      method: "POST",
      headers: { authorization: "Bearer wrong-token-000" },
    });
    expect(response.status).toBe(401);
  });

  it("issues a ticket to an authenticated caller", async () => {
    const base = await start({ authToken: TOKEN });
    const response = await fetch(`${base}/api/ws-ticket`, {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ticket: string };
    expect(body.ticket).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("invokes shutdown only through the authenticated daemon route", async () => {
    let shutdown = false;
    const base = await start({ authToken: TOKEN, shutdown: () => (shutdown = true) });
    const unauthorized = await fetch(`${base}/api/shutdown`, { method: "POST" });
    expect(unauthorized.status).toBe(401);
    expect(shutdown).toBe(false);

    const accepted = await fetch(`${base}/api/shutdown`, {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(accepted.status).toBe(202);
    expect(shutdown).toBe(true);
  });

  it("does not expose shutdown in browser mode", async () => {
    const base = await start({});
    const response = await fetch(`${base}/api/shutdown`, { method: "POST" });
    expect(response.status).toBe(404);
  });

  it("requires no token at all when none is configured (browser mode)", async () => {
    const base = await start({});
    const response = await fetch(`${base}/api/ws-ticket`, { method: "POST" });
    expect(response.status).toBe(200);
  });
});

describe("createServer browser pairing", () => {
  async function issueGrant(base: string): Promise<string> {
    const response = await fetch(`${base}/api/auth/pairing-grants`, {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = (await response.json()) as { grant: string };
    return body.grant;
  }

  async function exchangeGrant(base: string, grant: string): Promise<string> {
    const response = await fetch(`${base}/api/auth/browser-session`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: base },
      body: JSON.stringify({ grant }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const cookie = response.headers.get("set-cookie");
    expect(cookie).toContain("pie_session=");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).toContain("Max-Age=");
    expect(cookie).not.toContain("Domain=");
    expect(cookie).not.toContain("Secure");
    return cookie!.split(";", 1)[0]!;
  }

  it("does not let a browser session stop the daemon", async () => {
    let shutdown = false;
    const base = await start({ authToken: TOKEN, shutdown: () => (shutdown = true) });
    const cookie = await exchangeGrant(base, await issueGrant(base));
    const response = await fetch(`${base}/api/shutdown`, {
      method: "POST",
      headers: { cookie },
    });
    expect(response.status).toBe(403);
    expect(shutdown).toBe(false);
  });

  it("exchanges a one-time grant for a browser session cookie", async () => {
    const base = await start({ authToken: TOKEN });
    const grant = await issueGrant(base);
    const cookie = await exchangeGrant(base, grant);
    const session = await fetch(`${base}/api/auth/session`, { headers: { cookie } });
    expect(session.status).toBe(200);
    expect(session.headers.get("cache-control")).toBe("no-store");
    await expect(session.json()).resolves.toEqual({ authenticated: true });
  });

  it("rejects grant replay with the same response as an unknown grant", async () => {
    const base = await start({ authToken: TOKEN });
    const grant = await issueGrant(base);
    await exchangeGrant(base, grant);
    const replay = await fetch(`${base}/api/auth/browser-session`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: base },
      body: JSON.stringify({ grant }),
    });
    const unknown = await fetch(`${base}/api/auth/browser-session`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: base },
      body: JSON.stringify({ grant: "unknown" }),
    });
    expect([replay.status, await replay.text()]).toEqual([unknown.status, await unknown.text()]);
  });

  it("requires an exact same-origin loopback Origin for pairing exchange", async () => {
    const base = await start({ authToken: TOKEN });
    const grant = await issueGrant(base);
    const missing = await fetch(`${base}/api/auth/browser-session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ grant }),
    });
    const foreign = await fetch(`${base}/api/auth/browser-session`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://evil.example" },
      body: JSON.stringify({ grant }),
    });
    expect(missing.status).toBe(403);
    expect(foreign.status).toBe(403);
  });

  it("accepts only the strict small JSON grant shape", async () => {
    const base = await start({ authToken: TOKEN });
    const malformed = await fetch(`${base}/api/auth/browser-session`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: base },
      body: JSON.stringify({ grant: "x", extra: true }),
    });
    const large = await fetch(`${base}/api/auth/browser-session`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: base },
      body: JSON.stringify({ grant: "x".repeat(2_000) }),
    });
    expect(malformed.status).toBe(400);
    expect(large.status).toBe(413);
  });

  it("does not include a refused grant in structured logs", async () => {
    const records: Array<LogRecord> = [];
    const effectContext = await Effect.runPromise(
      Layer.build(
        Logger.layer([
          Logger.map(structured, (record) => {
            records.push(record);
          }),
        ]),
      ).pipe(Effect.scoped),
    );
    const base = await start({ authToken: TOKEN, effectContext });
    const marker = "sensitive-grant-marker";
    const response = await fetch(`${base}/api/auth/browser-session`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: base },
      body: JSON.stringify({ grant: marker }),
    });
    expect(response.status).toBe(401);
    expect(JSON.stringify(records)).not.toContain(marker);
  });

  it("lets a browser session mint a WS ticket but not a pairing grant", async () => {
    const base = await start({ authToken: TOKEN });
    const cookie = await exchangeGrant(base, await issueGrant(base));
    const ticket = await fetch(`${base}/api/ws-ticket`, { method: "POST", headers: { cookie } });
    expect(ticket.status).toBe(200);
    const pairing = await fetch(`${base}/api/auth/pairing-grants`, {
      method: "POST",
      headers: { cookie },
    });
    expect(pairing.status).toBe(403);
  });
});

describe("createServer CORS", () => {
  it("answers a preflight from an allowlisted origin", async () => {
    const base = await start({ authToken: TOKEN, corsOrigins: ["pie://app"] });
    const response = await fetch(`${base}/api/ws-ticket`, {
      method: "OPTIONS",
      headers: { origin: "pie://app" },
    });
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe("pie://app");
  });

  it("refuses a preflight from an unknown origin", async () => {
    const base = await start({ authToken: TOKEN, corsOrigins: ["pie://app"] });
    const response = await fetch(`${base}/api/ws-ticket`, {
      method: "OPTIONS",
      headers: { origin: "https://evil.example" },
    });
    expect(response.status).toBe(403);
  });
});

describe("createServer anti DNS-rebinding", () => {
  it("refuses a request whose Host is not loopback, even /api/health", async () => {
    await start({});
    const { port } = server!.address() as AddressInfo;
    const status = await new Promise<number>((resolve) => {
      const req = http.request(
        { host: "127.0.0.1", port, path: "/api/health", headers: { host: "evil.example" } },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        },
      );
      req.on("error", () => resolve(0));
      req.end();
    });
    expect(status).toBe(403);
  });
});

describe("createServer WebSocket ticket", () => {
  async function connect(
    base: string,
    query: string,
    path = "/ws/rpc",
    options?: WebSocket.ClientOptions,
  ): Promise<number> {
    const url = `${base.replace("http://", "ws://")}${path}${query}`;
    const socket = new WebSocket(url, "pie", options);
    return new Promise<number>((resolve) => {
      socket.on("open", () => {
        socket.close();
        resolve(200);
      });
      socket.on("unexpected-response", (_request, response) => resolve(response.statusCode ?? 0));
      socket.on("error", () => resolve(0));
    });
  }

  it("accepts an upgrade carrying a valid ticket", async () => {
    const base = await start({ authToken: TOKEN });
    const ticketResponse = await fetch(`${base}/api/ws-ticket`, {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    const { ticket } = (await ticketResponse.json()) as { ticket: string };
    await expect(connect(base, `?ticket=${ticket}`)).resolves.toBe(200);
  });

  it("accepts a ticket issued to a browser session", async () => {
    const base = await start({ authToken: TOKEN });
    const grantResponse = await fetch(`${base}/api/auth/pairing-grants`, {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    const { grant } = (await grantResponse.json()) as { grant: string };
    const sessionResponse = await fetch(`${base}/api/auth/browser-session`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: base },
      body: JSON.stringify({ grant }),
    });
    const cookie = sessionResponse.headers.get("set-cookie")!.split(";", 1)[0]!;
    const ticketResponse = await fetch(`${base}/api/ws-ticket`, {
      method: "POST",
      headers: { cookie },
    });
    const { ticket } = (await ticketResponse.json()) as { ticket: string };
    await expect(connect(base, `?ticket=${ticket}`, "/ws/rpc", { origin: base })).resolves.toBe(
      200,
    );
  });

  it("rejects an upgrade with no ticket", async () => {
    const base = await start({ authToken: TOKEN });
    await expect(connect(base, "")).resolves.toBe(401);
  });

  it("runs WebSocket callback logs on the supplied Effect context", async () => {
    const records: Array<LogRecord> = [];
    const effectContext = await Effect.runPromise(
      Layer.build(
        Logger.layer([
          Logger.map(structured, (record) => {
            records.push(record);
          }),
        ]),
      ).pipe(Effect.scoped),
    );
    const base = await start({ authToken: TOKEN, effectContext });

    await expect(connect(base, "")).resolves.toBe(401);
    await expect.poll(() => records.length).toBeGreaterThan(0);

    const record = records.find(
      (candidate) => candidate.annotations.event === "ws.upgrade_rejected",
    );
    expect(record?.annotations.reason).toBe("invalid_ticket");
  });

  it("only upgrades the WebSocket RPC path without consuming the ticket", async () => {
    const base = await start({ authToken: TOKEN });
    const ticketResponse = await fetch(`${base}/api/ws-ticket`, {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    const { ticket } = (await ticketResponse.json()) as { ticket: string };
    await expect(connect(base, `?ticket=${ticket}`, "/wrong-path")).resolves.toBe(404);
    await expect(connect(base, `?ticket=${ticket}`)).resolves.toBe(200);
  });

  it("rejects a replayed ticket", async () => {
    const base = await start({ authToken: TOKEN });
    const ticketResponse = await fetch(`${base}/api/ws-ticket`, {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    const { ticket } = (await ticketResponse.json()) as { ticket: string };
    await connect(base, `?ticket=${ticket}`);
    await expect(connect(base, `?ticket=${ticket}`)).resolves.toBe(401);
  });

  it("accepts an upgrade with no ticket when no token is configured (browser mode)", async () => {
    const base = await start({});
    await expect(connect(base, "")).resolves.toBe(200);
  });

  it("rejects a browser Origin outside the allowlist, even in browser mode", async () => {
    const base = await start({});
    await expect(connect(base, "", "/ws/rpc", { origin: "https://evil.example" })).resolves.toBe(
      403,
    );
  });

  it("accepts a proxy-forwarded upgrade whose Host and Origin name an allowed host", async () => {
    // The tailscale-serve shape: the proxy preserves its public Host, and the
    // page it served connects back with the matching browser Origin. Allowing
    // the Host but rejecting the Origin would render the app without a
    // working WebSocket.
    const base = await start({ allowedHosts: ["proxy.ts.net"] });
    await expect(
      connect(base, "", "/ws/rpc", {
        headers: { host: "proxy.ts.net" },
        origin: "https://proxy.ts.net",
      }),
    ).resolves.toBe(200);
  });

  it("keeps rejecting unrelated Origins when allowed hosts are configured", async () => {
    const base = await start({ allowedHosts: ["proxy.ts.net"] });
    await expect(connect(base, "", "/ws/rpc", { origin: "https://evil.example" })).resolves.toBe(
      403,
    );
  });
});

describe("createServer production UI", () => {
  it("serves /pair through the SPA fallback and its hashed entry asset", async () => {
    const base = await start({ authToken: TOKEN });
    const page = await fetch(`${base}/pair`, { headers: { accept: "text/html" } });
    expect(page.status).toBe(200);
    const html = await page.text();
    const entry = html.match(/src="(\/assets\/[^"]+\.js)"/)?.[1];
    expect(entry).toBeDefined();
    const asset = await fetch(`${base}${entry}`);
    expect(asset.status).toBe(200);
    expect(asset.headers.get("content-type")).toContain("javascript");
  });
});

describe("createServer staged startup", () => {
  const ui: UIApp = Effect.succeed(HttpServerResponse.text("ok"));

  /** Records its disposal so a test can assert it ran, and ran exactly once. */
  function fakeRuntime(released: string[]): RpcRuntime {
    return {
      context: { "effect/context": Context.empty() } as RpcRuntime["context"],
      run: () => Promise.reject(new Error("fake runtime cannot run effects")),
      dispose: async () => {
        released.push("rpcRuntime");
      },
    };
  }

  it("disposes the RPC runtime exactly once when UI creation fails", async () => {
    const released: string[] = [];
    await expect(
      createServer(
        {},
        {
          createRpcRuntime: async () => fakeRuntime(released),
          createUI: () => Promise.reject(new Error("ui failed")),
          createRequestHandler: () => Promise.reject(new Error("unreachable")),
        },
      ),
    ).rejects.toThrow("ui failed");
    expect(released).toEqual(["rpcRuntime"]);
  });

  it("closes the request scope and the runtime when the request handler fails", async () => {
    const released: string[] = [];
    await expect(
      createServer(
        {},
        {
          createRpcRuntime: async () => fakeRuntime(released),
          createUI: async () => ui,
          createRequestHandler: async (_runtime, _app, requestScope) => {
            await Effect.runPromise(
              Scope.addFinalizer(
                requestScope,
                Effect.sync(() => released.push("requestScope")),
              ),
            );
            throw new Error("handler failed");
          },
        },
      ),
    ).rejects.toThrow("handler failed");
    expect(released).toEqual(["requestScope", "rpcRuntime"]);
  });

  it("releases the stages in reverse acquisition order, exactly once, on dispose", async () => {
    const released: string[] = [];
    const managed = await createServer(
      {},
      {
        createRpcRuntime: async () => fakeRuntime(released),
        createUI: async () => ui,
        createRequestHandler: async (_runtime, _app, requestScope) => {
          await Effect.runPromise(
            Scope.addFinalizer(
              requestScope,
              Effect.sync(() => released.push("requestScope")),
            ),
          );
          return () => {};
        },
      },
    );
    await new Promise<void>((resolve) => {
      managed.listen(0, "127.0.0.1", resolve);
    });
    managed.once("close", () => released.push("http"));

    await managed.dispose();
    await managed.dispose();

    expect(managed.listening).toBe(false);
    expect(released).toEqual(["http", "requestScope", "rpcRuntime"]);
  });
});
