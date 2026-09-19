import path from "node:path";

/** How many exclusive-mkdir attempts after the first name before failing. */
export const ALLOCATE_FOLDER_ATTEMPTS = 100;

/** Relative path for one allocate attempt: `<YYYY-MM-DD>/Chat-<n>`. */
export function allocateProjectFolderName(now: Date, attempt: number): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return path.join(`${year}-${month}-${day}`, `Chat-${attempt}`);
}
