/**
 * Core domain types for the harness agent runtime.
 *
 * These are the plain data shapes shared across modules. Effect services
 * (Context.Service + Layer) live in each module; DTOs like these stay plain.
 */

/** A project is a workspace path the runtime can open sessions against. */
export type { Project } from "@pie/contract";

/**
 * Server-owned recovery record for one session, persisted at
 * `storage/sessions/<projectId>/<sessionId>.json`, inside a `{version, data}`
 * envelope that owns the version — this record does not carry one. The filename
 * mirrors `sessionId`, which is also stored in the body so a loaded record is
 * self-contained; `agentSessionId` is the Pi-native session id the server
 * translates to when opening or resuming the child process.
 */
export interface Session {
  readonly sessionId: string;
  readonly projectId: string;
  readonly agentSessionId: string;
  readonly createdAt: string;
  /**
   * Working directory. Our input at `create` (currently the project path).
   * Optional for legacy records; callers fall back to the project path.
   */
  readonly cwd?: string;
  /** Display title, set from the session's first prompt. */
  readonly title?: string;
  /** Whether the session is hidden from the project's primary session list. */
  readonly archived?: boolean;
  /** Recency (ISO). Reserved — not written yet (see the type doc). */
  readonly updatedAt?: string;
  /** Whether the backend still has the transcript. Reserved — not written yet. */
  readonly historyAvailable?: boolean;
}
