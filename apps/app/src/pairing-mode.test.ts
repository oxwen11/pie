import { describe, expect, it } from "vitest";

import { pairingModeFromStatus, probePairingMode, resolvePairingAccess } from "./pairing-mode";

describe("pairingModeFromStatus", () => {
  it("treats 404 as unauthenticated serve — no pairing routes", () => {
    expect(pairingModeFromStatus(404)).toBe("open");
  });

  it("requires pairing when mint/exchange exist", () => {
    expect(pairingModeFromStatus(400)).toBe("required");
    expect(pairingModeFromStatus(401)).toBe("required");
  });
});

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
  it("POSTs /api/pairing/exchange and follows the shipped 404-vs-pairing statuses", async () => {
    const calls: Array<{ url: string; method: string; body: string }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const body = typeof init?.body === "string" ? init.body : "";
      calls.push({
        url,
        method: init?.method ?? "GET",
        body,
      });
      return new Response("Not Found", { status: 404 });
    };
    await expect(probePairingMode(fetchImpl)).resolves.toBe("open");
    expect(calls).toEqual([
      {
        url: "/api/pairing/exchange",
        method: "POST",
        body: JSON.stringify({ code: "probe" }),
      },
    ]);

    const required: typeof fetch = async () => new Response("Unauthorized", { status: 401 });
    await expect(probePairingMode(required)).resolves.toBe("required");
  });
});
