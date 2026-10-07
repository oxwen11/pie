import sqlite from "node:sqlite";

/** Hub's synchronous SQLite store (docs/rfc/pie-hub.md, sections 6, 8 and 9). */

export const ENROLLMENT_TOKEN_TTL_MS = 10 * 60 * 1000;
export const MAX_UNUSED_ENROLLMENT_TOKENS = 10;
export const HOLD_TTL_MS = 24 * 60 * 60 * 1000;
export const DEDUPE_WINDOW_MS = 48 * 60 * 60 * 1000;
export const MAX_HELD_EVENTS = 1000;
export const MAX_HELD_BYTES = 100 * 1024 * 1024;

/** Ordered; index + 1 is the `user_version` it brings the database to. */
const MIGRATIONS = [
  `
CREATE TABLE environments (
  environment_id  TEXT PRIMARY KEY,
  credential_hash BLOB,
  state           TEXT NOT NULL CHECK (state IN ('active','revoked')),
  hold            INTEGER NOT NULL DEFAULT 1 CHECK (hold IN (0,1)),
  created_at      INTEGER NOT NULL,
  CHECK ((state='active') = (credential_hash IS NOT NULL AND length(credential_hash)=32))
) STRICT;
CREATE TABLE enrollment_tokens (
  token_hash BLOB PRIMARY KEY CHECK (length(token_hash)=32),
  expires_at INTEGER NOT NULL,
  used       INTEGER NOT NULL DEFAULT 0 CHECK (used IN (0,1))
) STRICT;
CREATE TABLE events (
  event_id       TEXT PRIMARY KEY,
  environment_id TEXT,
  type           TEXT NOT NULL,
  payload        TEXT CHECK (payload IS NULL OR json_valid(payload)),
  received_at    INTEGER NOT NULL,
  expires_at     INTEGER NOT NULL,
  outcome        TEXT CHECK (outcome IN ('accepted','duplicate','rejected','expired','daemon_not_connected','inbox_full','revoked','hold_disabled')),
  attempts       INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  CHECK (outcome IS NULL OR payload IS NULL)
) STRICT;
CREATE INDEX events_pending ON events (environment_id, received_at);
`,
];

export type EventOutcome =
  | "accepted"
  | "duplicate"
  | "rejected"
  | "expired"
  | "daemon_not_connected"
  | "inbox_full"
  | "revoked"
  | "hold_disabled";

export type EnrollResult = "enrolled" | "reenrolled" | "invalid_token" | "conflict";
export type InsertEventResult =
  | { readonly kind: "unknown_environment" }
  | { readonly kind: "duplicate" }
  | { readonly kind: "recorded"; readonly outcome: EventOutcome | null };

export interface HeldEvent {
  readonly eventId: string;
  readonly type: string;
  readonly payload: string;
  readonly receivedAt: number;
  readonly expiresAt: number;
  readonly attempts: number;
}

export interface InsertEventInput {
  readonly eventId: string;
  readonly environmentId: string;
  readonly type: string;
  /** The vendor JSON, already serialized and size-checked by the caller. */
  readonly payload: string;
  readonly now: number;
  /** Whether the Environment has a live socket right now. */
  readonly connected: boolean;
}

export class HubStoreError extends Error {
  override name = "HubStoreError";
}

type Row = Record<string, sqlite.SQLOutputValue>;

const num = (row: Row | undefined, key: string): number => {
  const v = row?.[key];
  if (typeof v !== "number") throw new HubStoreError(`column ${key} is not a number`);
  return v;
};
const text = (row: Row | undefined, key: string): string => {
  const v = row?.[key];
  if (typeof v !== "string") throw new HubStoreError(`column ${key} is not text`);
  return v;
};

export class HubStore {
  readonly #db: sqlite.DatabaseSync;

  private constructor(db: sqlite.DatabaseSync) {
    this.#db = db;
  }

  /** Opens (creating) the database, runs pending migrations, refuses a newer or damaged one. */
  static open(path: string): HubStore {
    const db = new sqlite.DatabaseSync(path);
    try {
      db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;");
      if (text(db.prepare("PRAGMA integrity_check").get(), "integrity_check") !== "ok")
        throw new HubStoreError("database failed integrity_check");
      const version = num(db.prepare("PRAGMA user_version").get(), "user_version");
      if (version > MIGRATIONS.length) {
        throw new HubStoreError(`database version ${version} is newer than this Hub`);
      }
      for (let v = version; v < MIGRATIONS.length; v++) {
        db.exec(`BEGIN IMMEDIATE; ${MIGRATIONS[v]}; PRAGMA user_version = ${v + 1}; COMMIT;`);
      }
    } catch (error) {
      db.close();
      throw error;
    }
    return new HubStore(db);
  }

  close(): void {
    this.#db.close();
  }

  #tx<T>(fn: () => T): T {
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      const out = fn();
      this.#db.exec("COMMIT");
      return out;
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
  }

  /** Returns false when ten unused, unexpired tokens already exist. */
  mintEnrollmentToken(tokenHash: Uint8Array, now: number): boolean {
    return this.#tx(() => {
      const n = num(
        this.#db
          .prepare("SELECT count(*) AS n FROM enrollment_tokens WHERE used = 0 AND expires_at > ?")
          .get(now),
        "n",
      );
      if (n >= MAX_UNUSED_ENROLLMENT_TOKENS) return false;
      this.#db
        .prepare("INSERT INTO enrollment_tokens (token_hash, expires_at) VALUES (?, ?)")
        .run(tokenHash, now + ENROLLMENT_TOKEN_TTL_MS);
      return true;
    });
  }

  /**
   * First valid connection: one transaction checks the token is unused and unexpired, pins the
   * UUID, stores the token hash as its credential and marks the token used. An active UUID is a
   * conflict; a revoked one re-enrolls.
   */
  enroll(tokenHash: Uint8Array, environmentId: string, now: number): EnrollResult {
    return this.#tx(() => {
      const token = this.#db
        .prepare(
          "SELECT 1 FROM enrollment_tokens WHERE token_hash = ? AND used = 0 AND expires_at > ?",
        )
        .get(tokenHash, now);
      if (!token) return "invalid_token";
      const env = this.#db
        .prepare("SELECT state FROM environments WHERE environment_id = ?")
        .get(environmentId);
      if (env && text(env, "state") === "active") return "conflict";
      if (env) {
        this.#db
          .prepare(
            "UPDATE environments SET state = 'active', credential_hash = ? WHERE environment_id = ?",
          )
          .run(tokenHash, environmentId);
      } else {
        this.#db
          .prepare(
            "INSERT INTO environments (environment_id, credential_hash, state, created_at) VALUES (?, ?, 'active', ?)",
          )
          .run(environmentId, tokenHash, now);
      }
      this.#db.prepare("UPDATE enrollment_tokens SET used = 1 WHERE token_hash = ?").run(tokenHash);
      return env ? "reenrolled" : "enrolled";
    });
  }

  /** True when the credential belongs to this active Environment. */
  authenticate(environmentId: string, credentialHash: Uint8Array): boolean {
    return (
      this.#db
        .prepare(
          "SELECT 1 FROM environments WHERE environment_id = ? AND state = 'active' AND credential_hash = ?",
        )
        .get(environmentId, credentialHash) !== undefined
    );
  }

  /** Revokes and ends its held events as `revoked`. False when it is unknown or already revoked. */
  revoke(environmentId: string): boolean {
    return this.#tx(() => {
      const res = this.#db
        .prepare(
          "UPDATE environments SET state = 'revoked', credential_hash = NULL WHERE environment_id = ? AND state = 'active'",
        )
        .run(environmentId);
      if (res.changes === 0) return false;
      this.#db
        .prepare(
          "UPDATE events SET outcome = 'revoked', payload = NULL WHERE environment_id = ? AND outcome IS NULL",
        )
        .run(environmentId);
      return true;
    });
  }

  /** Turning hold off deletes held events (RFC section 6). */
  setHold(environmentId: string, hold: boolean): boolean {
    return this.#tx(() => {
      const res = this.#db
        .prepare("UPDATE environments SET hold = ? WHERE environment_id = ? AND state = 'active'")
        .run(hold ? 1 : 0, environmentId);
      if (res.changes === 0) return false;
      if (!hold) {
        this.#db
          .prepare(
            "UPDATE events SET outcome = 'hold_disabled', payload = NULL WHERE environment_id = ? AND outcome IS NULL",
          )
          .run(environmentId);
      }
      return true;
    });
  }

  /**
   * Records an event before the caller answers 2xx. `outcome: null` means pending delivery.
   * An unknown or revoked target records nothing.
   */
  insertEvent(input: InsertEventInput): InsertEventResult {
    return this.#tx(() => {
      const env = this.#db
        .prepare("SELECT hold FROM environments WHERE environment_id = ? AND state = 'active'")
        .get(input.environmentId);
      if (!env) return { kind: "unknown_environment" } as const;

      let outcome: EventOutcome | null = null;
      if (!input.connected && num(env, "hold") === 0) {
        outcome = "daemon_not_connected";
      } else {
        const held = this.#db
          .prepare(
            "SELECT count(*) AS n, coalesce(sum(length(CAST(payload AS BLOB))), 0) AS bytes FROM events WHERE environment_id = ? AND outcome IS NULL",
          )
          .get(input.environmentId);
        const size = Buffer.byteLength(input.payload);
        if (num(held, "n") >= MAX_HELD_EVENTS || num(held, "bytes") + size > MAX_HELD_BYTES)
          outcome = "inbox_full";
      }

      const res = this.#db
        .prepare(
          "INSERT OR IGNORE INTO events (event_id, environment_id, type, payload, received_at, expires_at, outcome) VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          input.eventId,
          input.environmentId,
          input.type,
          outcome === null ? input.payload : null,
          input.now,
          input.now + HOLD_TTL_MS,
          outcome,
        );
      if (res.changes === 0) return { kind: "duplicate" } as const;
      return { kind: "recorded", outcome } as const;
    });
  }

  /** Pending events, oldest first. */
  pending(environmentId: string, limit: number): HeldEvent[] {
    return this.#db
      .prepare(
        "SELECT event_id AS eventId, type, payload, received_at AS receivedAt, expires_at AS expiresAt, attempts FROM events WHERE environment_id = ? AND outcome IS NULL ORDER BY received_at, event_id LIMIT ?",
      )
      .all(environmentId, limit)
      .map((r) => ({
        eventId: text(r, "eventId"),
        type: text(r, "type"),
        payload: text(r, "payload"),
        receivedAt: num(r, "receivedAt"),
        expiresAt: num(r, "expiresAt"),
        attempts: num(r, "attempts"),
      }));
  }

  /** Counts one send of a pending event; returns the new attempt number, or null if not pending. */
  recordAttempt(eventId: string): number | null {
    const row = this.#db
      .prepare(
        "UPDATE events SET attempts = attempts + 1 WHERE event_id = ? AND outcome IS NULL RETURNING attempts",
      )
      .get(eventId);
    return row ? num(row, "attempts") : null;
  }

  /** Ends a pending event with the daemon's answer and clears its payload. */
  ack(
    eventId: string,
    environmentId: string,
    outcome: "accepted" | "duplicate" | "rejected",
  ): boolean {
    const res = this.#db
      .prepare(
        "UPDATE events SET outcome = ?, payload = NULL WHERE event_id = ? AND environment_id = ? AND outcome IS NULL",
      )
      .run(outcome, eventId, environmentId);
    return res.changes > 0;
  }

  /** Expires held events past their TTL, then drops rows and tokens past their windows. */
  sweep(now: number): void {
    this.#tx(() => {
      this.#db
        .prepare(
          "UPDATE events SET outcome = 'expired', payload = NULL WHERE outcome IS NULL AND expires_at <= ?",
        )
        .run(now);
      this.#db
        .prepare("DELETE FROM events WHERE outcome IS NOT NULL AND received_at <= ?")
        .run(now - DEDUPE_WINDOW_MS);
      this.#db.prepare("DELETE FROM enrollment_tokens WHERE used = 1 OR expires_at <= ?").run(now);
    });
  }
}
