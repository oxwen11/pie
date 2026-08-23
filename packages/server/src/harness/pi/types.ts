/** Live display data for a session, fetched from Pi at list time. */
export type AgentSessionInfo = {
  readonly title?: string;
  readonly updatedAt?: number;
};

export type AvailabilityResult = {
  readonly available: boolean;
  readonly reason?: string;
};

/**
 * Result of looking up a persisted session's Pi backend info:
 * - `found`       — Pi still has it; `info` carries display fields
 * - `missing`     — Pi transcript is gone (deleted); not resumable
 * - `unsupported` — Pi cannot query session info (treat as unknown)
 */
export type SessionInfoResult =
  | { readonly _tag: "found"; readonly info: AgentSessionInfo }
  | { readonly _tag: "missing" }
  | { readonly _tag: "unsupported" };
