import os from "node:os";
import path from "node:path";

import { type GitCheckout, resolveGitCheckout } from "@getpie/core/development-scope";
import { Context, Layer } from "effect";

/**
 * Resolved filesystem locations the runtime persists to. Injected as a service
 * so tests can point it at a temp dir instead of `~/.pie`.
 *
 * `projects.json` lives under `storage/` (a data collection).
 */
export class Paths extends Context.Service<
  Paths,
  {
    readonly home: string;
    readonly projectsFile: string;
    /** `storage/sessions/` — one `<projectId>/` subdir per project. */
    readonly sessionsDir: string;
    /** `storage/schedules/` — one `<scheduleId>.json` per application-level Schedule. */
    readonly schedulesDir: string;
    /** `worktrees/` — git worktree checkouts, grouped per repository. */
    readonly worktreesDir: string;
    /** `$PIE_HOME/logs` — process log and daemon stdio. */
    readonly logsDir: string;
  }
>()("Paths") {}

/** Owner-only, matching `daemon.pid`. Shared by the log layer and the launcher. */
export const LOGS_DIRECTORY_MODE = 0o700;
export const LOG_FILE_MODE = 0o600;

export const PIE_LOG_FILE = "pie.log";
export const DAEMON_STDIO_LOG_FILE = "daemon-stdio.log";

const resolve = (home: string) => ({
  home,
  projectsFile: path.join(home, "storage", "projects.json"),
  sessionsDir: path.join(home, "storage", "sessions"),
  schedulesDir: path.join(home, "storage", "schedules"),
  worktreesDir: path.join(home, "worktrees"),
  logsDir: logsDirectory(home),
});

/**
 * Directory name under the user home for a Git checkout of the running code.
 * `/` becomes `--` so `feat/xx` and `feat-xx` stay distinct.
 */
export function defaultPieHomeDir(git: GitCheckout): string {
  if (!git.inGit) return ".pie";
  if (!git.branch) return ".pie_dev";
  const segment = git.branch.replaceAll("/", "--").replaceAll(/[^a-zA-Z0-9._-]/g, "-");
  return `.pie_${segment}`;
}

/**
 * `$PIE_HOME`, else installed `~/.pie`, a git checkout `~/.pie_<branch>`
 * (`/` → `--`), or `~/.pie_dev` when the branch is unreadable. Probes git from
 * this file's on-disk location, not cwd.
 */
export function resolvePieHome(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.PIE_HOME;
  if (raw !== undefined && raw.trim() !== "") return raw;
  return path.join(os.homedir(), defaultPieHomeDir(resolveGitCheckout(import.meta.dirname)));
}

/** `$PIE_HOME/daemon` — pid, lock, and stop tombstone. */
export const daemonDirectory = (home: string): string => path.join(home, "daemon");

/** `$PIE_HOME/daemon` from the same home `resolvePieHome` would pick. */
export function resolveDaemonDirectory(env: NodeJS.ProcessEnv = process.env): string {
  return daemonDirectory(resolvePieHome(env));
}

/** `$PIE_HOME/logs` — the one directory every server process writes logs to. */
export const logsDirectory = (home: string): string => path.join(home, "logs");

export const pieLogPath = (logsDir: string): string => path.join(logsDir, PIE_LOG_FILE);

export const daemonStdioLogPath = (logsDir: string): string =>
  path.join(logsDir, DAEMON_STDIO_LOG_FILE);

/** Point the runtime at an explicit home directory (used in tests). */
export const layerPaths = (home: string): Layer.Layer<Paths> => Layer.succeed(Paths, resolve(home));

/** Default: `$PIE_HOME`, else installed `~/.pie` or checkout `~/.pie_<branch>`. */
export const PathsLayer: Layer.Layer<Paths> = Layer.sync(
  Paths,
  // Resolved when the layer is built, not when this module is imported — the
  // daemon sets `PIE_HOME` in the child's environment.
  () => resolve(resolvePieHome()),
);
