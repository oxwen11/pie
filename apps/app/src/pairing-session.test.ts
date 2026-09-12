import { describe, expect, it } from "vitest";

import {
  clearPairingSession,
  connectionFromOrigin,
  PAIRING_SESSION_STORAGE_KEY,
  readPairingSession,
  writePairingSession,
} from "./pairing-session";

function memoryStorage(initial: Record<string, string> = {}) {
  const data = { ...initial };
  return {
    getItem: (key: string) => data[key] ?? null,
    setItem: (key: string, value: string) => {
      data[key] = value;
    },
    removeItem: (key: string) => {
      delete data[key];
    },
    data,
  };
}

describe("pairing session", () => {
  it("round-trips a session token and does not invent a daemon token", () => {
    const storage = memoryStorage();
    writePairingSession({ token: "session-token", environmentId: "env-1" }, storage);
    expect(readPairingSession(storage)).toEqual({
      token: "session-token",
      environmentId: "env-1",
    });
    expect(storage.data[PAIRING_SESSION_STORAGE_KEY]).not.toContain("daemon");
    const connection = connectionFromOrigin("session-token", "http://192.168.31.135:4180");
    expect(connection).toEqual({
      httpBaseUrl: "http://192.168.31.135:4180",
      wsBaseUrl: "ws://192.168.31.135:4180",
      token: "session-token",
    });
    clearPairingSession(storage);
    expect(readPairingSession(storage)).toBeNull();
  });

  it("rejects garbage and a missing token", () => {
    expect(readPairingSession(memoryStorage({ [PAIRING_SESSION_STORAGE_KEY]: "{" }))).toBeNull();
    expect(
      readPairingSession(
        memoryStorage({
          [PAIRING_SESSION_STORAGE_KEY]: JSON.stringify({ environmentId: "env-1" }),
        }),
      ),
    ).toBeNull();
  });
});
