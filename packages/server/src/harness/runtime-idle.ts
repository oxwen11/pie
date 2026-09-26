/**
 * How long a live Pi runtime may sit at phase `idle` before the session
 * suspends it (kills the process, keeps the session). Overridable for tests
 * and ops via `PIE_SESSION_RUNTIME_IDLE_MS` (milliseconds). `0` disables.
 */
export const DEFAULT_SESSION_RUNTIME_IDLE_MS = 5 * 60 * 1000;

export const sessionRuntimeIdleMs = (
  env: NodeJS.ProcessEnv = process.env,
): number => {
  const raw = env.PIE_SESSION_RUNTIME_IDLE_MS?.trim();
  if (raw === undefined || raw === "") return DEFAULT_SESSION_RUNTIME_IDLE_MS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_SESSION_RUNTIME_IDLE_MS;
  return Math.floor(parsed);
};
