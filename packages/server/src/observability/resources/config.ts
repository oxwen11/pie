export const RESOURCE_SAMPLE_INTERVAL_MS = 5_000;
export const RESOURCE_LINE_LIMIT_BYTES = 64 * 1024;
export const RESOURCE_ROUND_LIMIT_BYTES = 1024 * 1024;
export const RESOURCE_FILE_LIMIT_BYTES = 16 * 1024 * 1024;
export const RESOURCE_SOURCE_LIMIT_BYTES = 64 * 1024 * 1024;
export const RESOURCE_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;
export const RESOURCE_FILE_OPEN_LIMIT_MS = 60 * 60 * 1_000;
export const RESOURCE_FILE_COUNT_LIMIT = 256;
export const RESOURCE_RECOVERY_INTERVAL_MS = 60_000;

type ResourceLoggingSetting = {
  readonly enabled: boolean;
  readonly invalid: boolean;
};

/** Pure startup parsing; callers decide how to report an invalid value. */
export function resolveResourceLoggingSetting(env: NodeJS.ProcessEnv): ResourceLoggingSetting {
  const value = env.PIE_RESOURCE_LOGGING;
  if (value === undefined || value === "1") return { enabled: true, invalid: false };
  if (value === "0") return { enabled: false, invalid: false };
  return { enabled: false, invalid: true };
}
