import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import {
  createPairingStore,
  PAIRING_CODE_TTL_MS,
  parsePairingExchange,
} from "../../src/http/pairing";
import { createServer, type ManagedServer } from "../../src/http/server";
import { discardContext } from "../platform";

const TOKEN = "test-token-0000";
const ENVIRONMENT_ID = "env-test-0001";

describe("parsePairingExchange", () => {
  it("reads a code and rejects garbage", () => {
    expect(parsePairingExchange(JSON.stringify({ code: "AB12CD34" }))).toEqual({
      code: "AB12CD34",
    });
    expect(parsePairingExchange("{")).toBeNull();
    expect(parsePairingExchange(JSON.stringify({ code: "  " }))).toBeNull();
  });
});

describe("createPairingStore", () => {
  it("exchanges a minted code once for a session that is not the daemon token", () => {
    const store = createPairingStore();
    const { code } = store.mint();
    const session = store.exchange(code);
    expect(session?.token).toEqual(expect.any(String));
    expect(session?.token).not.toBe(TOKEN);
    expect(store.accepts(session?.token ?? null)).toBe(true);
    expect(store.exchange(code)).toBeNull();
  });

  it("rejects an expired code", () => {
    let now = 1_000;
    const store = createPairingStore({ now: () => now });
    const { code } = store.mint();
    now += PAIRING_CODE_TTL_MS + 1;
    expect(store.exchange(code)).toBeNull();
  });
});

describe("createServer pairing", () => {
  let server: ManagedServer | undefined;

  async function start(): Promise<string> {
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
    return `http://127.0.0.1:${port}`;
  }

  afterEach(async () => {
    await server?.dispose();
    server = undefined;
  });

  it("mints with the daemon token, exchanges without it, and keeps the session across a second call", async () => {
    const base = await start();
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
    expect(session.environmentId).toBe(ENVIRONMENT_ID);
    expect(session.token).not.toBe(TOKEN);

    const ticket = await fetch(`${base}/api/ws-ticket`, {
      method: "POST",
      headers: { authorization: `Bearer ${session.token}` },
    });
    expect(ticket.status).toBe(200);

    const again = await fetch(`${base}/api/ws-ticket`, {
      method: "POST",
      headers: { authorization: `Bearer ${session.token}` },
    });
    expect(again.status).toBe(200);

    const environment = await fetch(`${base}/api/environment`, {
      headers: { authorization: `Bearer ${session.token}` },
    });
    await expect(environment.json()).resolves.toEqual({ id: ENVIRONMENT_ID });

    const anonymousEnvironment = await fetch(`${base}/api/environment`);
    expect(anonymousEnvironment.status).toBe(401);

    const shutdown = await fetch(`${base}/api/shutdown`, {
      method: "POST",
      headers: { authorization: `Bearer ${session.token}` },
    });
    expect(shutdown.status).toBe(401);
  });

  it("does not mint with a session token or without a token", async () => {
    const base = await start();
    const minted = await fetch(`${base}/api/pairing/mint`, {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    const { code } = (await minted.json()) as { code: string };
    const exchanged = await fetch(`${base}/api/pairing/exchange`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code }),
    });
    const session = (await exchanged.json()) as { token: string };

    const withSession = await fetch(`${base}/api/pairing/mint`, {
      method: "POST",
      headers: { authorization: `Bearer ${session.token}` },
    });
    expect(withSession.status).toBe(401);

    const anonymous = await fetch(`${base}/api/pairing/mint`, { method: "POST" });
    expect(anonymous.status).toBe(401);
  });
});

describe("createServer pairing absent", () => {
  let server: ManagedServer | undefined;

  afterEach(async () => {
    await server?.dispose();
    server = undefined;
  });

  it("404s pairing exchange when auth is off, so the web SPA can skip the gate", async () => {
    server = await createServer({ effectContext: await discardContext() });
    await new Promise<void>((resolve) => {
      server?.listen(0, "127.0.0.1", resolve);
    });
    const { port } = server.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${String(port)}/api/pairing/exchange`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: "probe" }),
    });
    expect(response.status).toBe(404);
  });

  it("returns GET /api/environment without pairing when auth is off", async () => {
    server = await createServer({
      environmentId: ENVIRONMENT_ID,
      effectContext: await discardContext(),
    });
    await new Promise<void>((resolve) => {
      server?.listen(0, "127.0.0.1", resolve);
    });
    const { port } = server.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${String(port)}/api/environment`);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ id: ENVIRONMENT_ID });
  });
});
