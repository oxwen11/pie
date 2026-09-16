import os from "node:os";
import path from "node:path";

/** Default directory name under the user home when `PIE_NEW_PROJECT_ROOT` is unset. */
export const DEFAULT_NEW_PROJECT_DIR = "Pie";

/** Leaf name when the allocate title does not yield a slug. */
export const ALLOCATE_FALLBACK_SLUG = "chat";

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

/**
 * First-prompt hint → a single path segment. Empty after sanitizing means
 * the caller should use `ALLOCATE_FALLBACK_SLUG`.
 */
export function slugifyProjectTitle(title: string | undefined): string | undefined {
  if (title === undefined) return undefined;
  const slug = title
    .normalize("NFKD")
    .replaceAll(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-+|-+$/g, "")
    .slice(0, 40)
    .replaceAll(/-+$/g, "");
  return slug.length > 0 ? slug : undefined;
}

/** Leaf basename under the date folder. Attempt 1 is the slug; later attempts append `-<n>`. */
export function allocateProjectLeafName(title: string | undefined, attempt: number): string {
  const slug = slugifyProjectTitle(title) ?? ALLOCATE_FALLBACK_SLUG;
  return attempt <= 1 ? slug : `${slug}-${attempt}`;
}

/**
 * Relative path for one allocate attempt: `<YYYY-MM-DD>/<slug>`.
 * Attempt 1 is the slug (or `chat`); later attempts append `-<n>` on the leaf.
 */
export function allocateProjectFolderName(
  now: Date,
  title: string | undefined,
  attempt: number,
): string {
  return path.join(formatAllocateDate(now), allocateProjectLeafName(title, attempt));
}
