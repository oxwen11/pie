import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sqlite from "node:sqlite";

import { describe, expect, it } from "vitest";

import {
  DEDUPE_WINDOW_MS,
  ENROLLMENT_TOKEN_TTL_MS,
  HOLD_TTL_MS,
  HubStore,
  MAX_HELD_EVENTS,
  MAX_UNUSED_ENROLLMENT_TOKENS,
} from "../src/store";

const hash = (s: string) => crypto.createHash("sha256").update(s).digest();
const ENV = "3f0f2c5e-6b0e-4c53-9c0a-1d2e3f4a5b6c";
const T0 = 1_000_000;

const enrolled = () => {
  const store = HubStore.open(":memory:");
  assert.equal(store.mintEnrollmentToken(hash("tok"), T0), true);
  assert.equal(store.enroll(hash("tok"), ENV, T0), "enrolled");
  return store;
};
const event = (id: string, over: Partial<Parameters<HubStore["insertEvent"]>[0]> = {}) => ({
  eventId: id,
  environmentId: ENV,
  type: "issue_comment.created",
  payload: '{"a":1}',
  now: T0,
  connected: false,
  ...over,
});

describe("enrollment", () => {
  it("pins the UUID once, consumes the token and authenticates with its hash", () => {
    const store = enrolled();
    expect(store.authenticate(ENV, hash("tok"))).toBe(true);
    expect(store.authenticate(ENV, hash("other"))).toBe(false);
    expect(store.enroll(hash("tok"), "00000000-0000-4000-8000-000000000000", T0)).toBe(
      "invalid_token",
    );
  });

  it("rejects an expired token", () => {
    const store = HubStore.open(":memory:");
    store.mintEnrollmentToken(hash("tok"), T0);
    expect(store.enroll(hash("tok"), ENV, T0 + ENROLLMENT_TOKEN_TTL_MS)).toBe("invalid_token");
  });

  it("allows at most ten unused tokens", () => {
    const store = HubStore.open(":memory:");
    for (let i = 0; i < MAX_UNUSED_ENROLLMENT_TOKENS; i++) {
      expect(store.mintEnrollmentToken(hash(`t${i}`), T0)).toBe(true);
    }
    expect(store.mintEnrollmentToken(hash("one-more"), T0)).toBe(false);
    expect(store.mintEnrollmentToken(hash("later"), T0 + ENROLLMENT_TOKEN_TTL_MS)).toBe(true);
  });

  it("conflicts on an active UUID and re-enrolls a revoked one with a fresh credential", () => {
    const store = enrolled();
    store.mintEnrollmentToken(hash("tok2"), T0);
    expect(store.enroll(hash("tok2"), ENV, T0)).toBe("conflict");
    expect(store.revoke(ENV)).toBe(true);
    expect(store.revoke(ENV)).toBe(false);
    expect(store.authenticate(ENV, hash("tok"))).toBe(false);
    expect(store.enroll(hash("tok2"), ENV, T0)).toBe("reenrolled");
    expect(store.authenticate(ENV, hash("tok2"))).toBe(true);
  });
});

describe("events", () => {
  it("records nothing for an unknown or revoked target", () => {
    const store = enrolled();
    expect(
      store.insertEvent(event("a", { environmentId: "00000000-0000-4000-8000-000000000000" })),
    ).toEqual({
      kind: "unknown_environment",
    });
    store.revoke(ENV);
    expect(store.insertEvent(event("a"))).toEqual({ kind: "unknown_environment" });
  });

  it("holds while offline, delivers oldest first, and clears the payload on ack", () => {
    const store = enrolled();
    store.insertEvent(event("b", { now: T0 + 2 }));
    store.insertEvent(event("a", { now: T0 + 1 }));
    expect(store.pending(ENV, 10).map((e) => e.eventId)).toEqual(["a", "b"]);
    expect(store.recordAttempt("a")).toBe(1);
    expect(store.ack("a", ENV, "accepted")).toBe(true);
    expect(store.ack("a", ENV, "accepted")).toBe(false);
    expect(store.pending(ENV, 10).map((e) => e.eventId)).toEqual(["b"]);
  });

  it("dedupes on the event id, including after the event settled", () => {
    const store = enrolled();
    expect(store.insertEvent(event("a"))).toEqual({ kind: "recorded", outcome: null });
    store.ack("a", ENV, "accepted");
    expect(store.insertEvent(event("a"))).toEqual({ kind: "duplicate" });
  });

  it("ends offline events terminally when hold is off, and deletes held ones when turned off", () => {
    const store = enrolled();
    store.insertEvent(event("held"));
    expect(store.setHold(ENV, false)).toBe(true);
    expect(store.pending(ENV, 10)).toEqual([]);
    expect(store.insertEvent(event("off"))).toEqual({
      kind: "recorded",
      outcome: "daemon_not_connected",
    });
    expect(store.insertEvent(event("on", { connected: true }))).toEqual({
      kind: "recorded",
      outcome: null,
    });
  });

  it("ends events as inbox_full at the count cap while held ones still deliver", () => {
    const store = enrolled();
    for (let i = 0; i < MAX_HELD_EVENTS; i++) store.insertEvent(event(`e${i}`, { now: T0 + i }));
    expect(store.insertEvent(event("over"))).toEqual({ kind: "recorded", outcome: "inbox_full" });
    expect(store.pending(ENV, 2000)).toHaveLength(MAX_HELD_EVENTS);
  });

  it("ends held events as revoked on revocation", () => {
    const store = enrolled();
    store.insertEvent(event("a"));
    store.revoke(ENV);
    expect(store.pending(ENV, 10)).toEqual([]);
  });

  it("expires held events after the TTL and keeps dedupe rows for 48 hours", () => {
    const store = enrolled();
    store.insertEvent(event("a"));
    store.sweep(T0 + HOLD_TTL_MS);
    expect(store.pending(ENV, 10)).toEqual([]);
    expect(store.insertEvent(event("a", { now: T0 + HOLD_TTL_MS }))).toEqual({ kind: "duplicate" });
    store.sweep(T0 + DEDUPE_WINDOW_MS);
    expect(store.insertEvent(event("a", { now: T0 + DEDUPE_WINDOW_MS }))).toEqual({
      kind: "recorded",
      outcome: null,
    });
  });
});

describe("open", () => {
  const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), "hub-store-"));

  it("persists across reopen and refuses a database newer than the code", () => {
    const file = path.join(dir(), "hub.sqlite");
    const a = HubStore.open(file);
    a.mintEnrollmentToken(hash("tok"), T0);
    a.enroll(hash("tok"), ENV, T0);
    a.close();
    const b = HubStore.open(file);
    expect(b.authenticate(ENV, hash("tok"))).toBe(true);
    b.close();

    const raw = new sqlite.DatabaseSync(file);
    raw.exec("PRAGMA user_version = 99");
    raw.close();
    expect(() => HubStore.open(file)).toThrow(/newer/);
  });
});
