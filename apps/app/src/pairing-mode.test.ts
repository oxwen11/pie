import { describe, expect, it } from "vitest";

import {
  probePairingMode,
  resolvePairingAccess,
  validateStoredPairingSession,
} from "./pairing-mode";

describe("resolvePairingAccess", () => {
  const stored = { token: "session-token", environmentId: "env-1" };

  it("loads AppInterface without a token when pairing is off, even if a session is stored", () => {
    expect(resolvePairingAccess("open", null)).toEqual({ kind: "open" });
    expect(resolvePairingAccess("open", stored)).toEqual({ kind: "open" });
  });

  it("uses a stored session only when pairing routes exist", () => {
    expect(resolvePairingAccess("required", stored)).toEqual({
      kind: "session",
      session: stored,
    });
    expect(resolvePairingAccess("required", null)).toEqual({ kind: "pair" });
  });
});

describe("probePairingMode", () => {
  it("treats GET /api/environment 200 as unauthenticated serve", async () => {
    const calls: Array<{ url: string; method: string }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      calls.push({
        url,
        method: init?.method ?? "GET",
      });
      return Response.json({ id: "env-1" });
    };
    await expect(probePairingMode(fetchImpl)).resolves.toBe("open");
    expect(calls).toEqual([{ url: "/api/environment", method: "GET" }]);
  });

  it("treats GET /api/environment 401 as pairing required", async () => {
    const required: typeof fetch = async () => new Response("Unauthorized", { status: 401 });
    await expect(probePairingMode(required)).resolves.toBe("required");
  });
});

describe("validateStoredPairingSession", () => {
  const stored = { token: "session-token", environmentId: "env-1" };

  it("keeps a token the daemon still accepts", async () => {
    const fetchImpl: typeof fetch = async (_input, init) => {
      expect(init?.headers).toEqual({ authorization: "Bearer session-token" });
      return Response.json({ id: "env-1" });
    };
    await expect(validateStoredPairingSession(stored, fetchImpl)).resolves.toEqual(stored);
  });

  it("drops a rejected token", async () => {
    const fetchImpl: typeof fetch = async () => new Response("Unauthorized", { status: 401 });
    await expect(validateStoredPairingSession(stored, fetchImpl)).resolves.toBeNull();
  });
});
