import os from "node:os";
import path from "node:path";

import { Context, Layer } from "effect";

/**
 * Resolved filesystem locations the runtime persists to. Injected as a service
 * so tests can point it at a temp dir instead of `~/.pie`.
 *
 * `projects.json` lives under `storage/` (a data collection).
 * `config.toml` lives at the home root (three owner tables: `[ui]` SPA,
 * `[desktop]` host, `[agent]` operator). Desktop Main reads `desktop.window`
 * from that file before the daemon is up.
 */
export class Paths extends Context.Service<
  Paths,
  {
    readonly home: string;
    readonly projectsFile: string;
    /** `$PIE_HOME/config.toml` — `[ui]` / `[desktop]` / `[agent]`, not a storage collection. */
    readonly configFile: string;
    /** `storage/sessions/` — one `<projectId>/` subdir per project. */
    readonly sessionsDir: string;
    /** `worktrees/` — git worktree checkouts, grouped per repository. */
    readonly worktreesDir: string;
    /** `$PIE_HOME/logs` — process log and daemon stdio. */
    readonly logsDir: string;
  }
>()("Paths") {}

/** Owner-only, matching `daemon.pid`. Shared by the log layer and the launcher. */
export const LOGS_DIRECTORY_MODE = 0o700;
export const LOG_FILE_MODE = 0o600;
/** Owner-only, matching log files — `config.toml` may grow secrets later. */
export const CONFIG_FILE_MODE = 0o600;

export const PIE_LOG_FILE = "pie.log";
export const DAEMON_STDIO_LOG_FILE = "daemon-stdio.log";

const resolve = (home: string) => ({
  home,
  projectsFile: path.join(home, "storage", "projects.json"),
  configFile: configFilePath(home),
  sessionsDir: path.join(home, "storage", "sessions"),
  worktreesDir: path.join(home, "worktrees"),
  logsDir: logsDirectory(home),
});

/**
 * An unset variable and one set to the empty string mean the same thing here.
 * Without this, `PIE_DAEMON_DIR=""` resolves every lifecycle file to a bare
 * relative path under whatever cwd the process happens to have — `stop` and
 * `status` would silently read the wrong daemon instead of failing.
 */
const explicitPath = (value: string | undefined): string | undefined =>
  value === undefined || value.trim() === "" ? undefined : value;

/**
 * `$PIE_HOME`, falling back to `~/.pie-dev` under
 * `NODE_ENV=development` and `~/.pie` otherwise — the single home every
 * client (server Paths, CLI, desktop, daemon launcher) resolves through, so
 * Project and Session storage can never drift on a second definition.
 * The dev split keeps `pnpm dev` / `electron-vite dev` sessions from sharing
 * storage (and, by default, a daemon) with the production install.
 *
 * A plain function, not an Effect: an env lookup and a string join perform no
 * effectful work (`.agents/rules/stack.md`, "Where the boundary is"). Not
 * because callers lack a runtime — every one of them is inside an `Effect.gen`
 * today — but because there is nothing here to suspend.
 */
export function resolvePieHome(env: NodeJS.ProcessEnv = process.env): string {
  return (
    explicitPath(env.PIE_HOME) ??
    path.join(os.homedir(), env.NODE_ENV === "development" ? ".pie-dev" : ".pie")
  );
}

/** The two directories a daemon front door needs, resolved together. */
export type DaemonLocation = {
  /** `$PIE_HOME` — Projects and Sessions. Handed to the daemon process. */
  readonly home: string;
  /** `$PIE_DAEMON_DIR` — `daemon.pid`, `.lock`, `.stopped`. Lifecycle state
   * only; the daemon's logs live under `$PIE_HOME/logs`. */
  readonly daemonDir: string;
};

/**
 * Where a daemon keeps its data and its lifecycle files. Every front door (CLI,
 * desktop, and any future one) resolves the pair here rather than pairing them
 * itself: `stop` must find what `start` wrote, and the desktop must find what
 * the CLI started, which only holds while there is one pairing rule.
 *
 * An explicit `$PIE_DAEMON_DIR` lets multiple daemon processes use separate
 * lifecycle state while keeping their server data under the same
 * `$PIE_HOME`; unset, it is `$PIE_HOME/daemon` (`~/.pie/daemon` in
 * production). This is the one place that default is spelled — the
 * single-instance invariant is keyed on the daemon directory, so a second
 * definition would be a second daemon. `daemon/paths.ts` names files inside a
 * directory it is handed and never re-derives the directory itself.
 */
export function resolveDaemonLocation(env: NodeJS.ProcessEnv = process.env): DaemonLocation {
  const home = resolvePieHome(env);
  return { home, daemonDir: explicitPath(env.PIE_DAEMON_DIR) ?? path.join(home, "daemon") };
}

/** `resolveDaemonLocation().daemonDir`, for callers that need only the directory. */
export function resolveDaemonDirectory(env: NodeJS.ProcessEnv = process.env): string {
  return resolveDaemonLocation(env).daemonDir;
}

/** `$PIE_HOME/config.toml` — `[ui]` / `[desktop]` / `[agent]`. */
export const configFilePath = (home: string): string => path.join(home, "config.toml");

/** `$PIE_HOME/logs` — the one directory every server process writes logs to. */
export const logsDirectory = (home: string): string => path.join(home, "logs");

export const pieLogPath = (logsDir: string): string => path.join(logsDir, PIE_LOG_FILE);

export const daemonStdioLogPath = (logsDir: string): string =>
  path.join(logsDir, DAEMON_STDIO_LOG_FILE);

/** Point the runtime at an explicit home directory (used in tests). */
export const layerPaths = (home: string): Layer.Layer<Paths> => Layer.succeed(Paths, resolve(home));

/** Default: `$PIE_HOME`, falling back to `~/.pie-dev` (dev) / `~/.pie`. */
export const PathsLayer: Layer.Layer<Paths> = Layer.sync(
  Paths,
  // Resolved when the layer is built, not when this module is imported — the
  // daemon sets `PIE_HOME` in the child's environment.
  () => resolve(resolvePieHome()),
);
