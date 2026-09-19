import os from "node:os";
import path from "node:path";

/** Default directory name under the user home when `PIE_NEW_PROJECT_ROOT` is unset. */
export const DEFAULT_NEW_PROJECT_DIR = "Pie";

/** How many exclusive-mkdir attempts after the first name before failing. */
export const ALLOCATE_FOLDER_ATTEMPTS = 100;

/**
 * Parent directory for folders minted by `project.allocate`.
 * `PIE_NEW_PROJECT_ROOT` wins when non-empty; otherwise `~/Pie`.
 * This is user data, not `$PIE_HOME`.
 */
export function resolveNewProjectRoot(
  env: NodeJS.ProcessEnv = process.env,
  homedir: () => string = os.homedir,
): string {
  const raw = env.PIE_NEW_PROJECT_ROOT;
  if (raw !== undefined && raw.trim() !== "") return path.resolve(raw);
  return path.join(homedir(), DEFAULT_NEW_PROJECT_DIR);
}

/** Local-calendar `YYYY-MM-DD` used as the date parent segment. */
export function formatAllocateDate(now: Date): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Relative path for one allocate attempt: `<YYYY-MM-DD>/Chat-<n>`. */
export function allocateProjectFolderName(now: Date, attempt: number): string {
  return path.join(formatAllocateDate(now), `Chat-${attempt}`);
}
