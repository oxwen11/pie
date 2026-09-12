import fs from "node:fs";
import path from "node:path";
import url from "node:url";

import { Effect, FileSystem } from "effect";

import { findExecutable, type FindExecutableDeps } from "../executable";

/** How the server spawns the Pi RPC child. */
export type PiExecutable = {
  readonly command: string;
  readonly prefixArgs: ReadonlyArray<string>;
};

/** Host runtime for the Pi RPC child. Default is Node (shebang / `process.execPath`). */
export type PiRuntime = "node" | "bun";

export type ResolvePiExecutableOptions = {
  /** Test seam — production uses {@link resolvePiRpcEntry}. */
  readonly resolveBundledCli?: () => string | undefined;
};

const JS_CLI_ENTRY = /\.[cm]?js$/i;

const existingFile = (pathname: string | undefined): string | undefined => {
  if (pathname === undefined) return undefined;
  try {
    return fs.existsSync(pathname) ? pathname : undefined;
  } catch {
    return undefined;
  }
};

const resolvedPackageFile = (specifier: string): string | undefined => {
  try {
    return existingFile(url.fileURLToPath(import.meta.resolve(specifier)));
  } catch {
    return undefined;
  }
};

/**
 * Pie-owned RPC child via package exports only: workspace/desktop
 * `@getpie/server/pi-rpc`, published CLI `@getpie/cli/pi-rpc`.
 */
export function resolvePiRpcEntry(): string | undefined {
  return resolvedPackageFile("@getpie/server/pi-rpc") ?? resolvedPackageFile("@getpie/cli/pi-rpc");
}

/**
 * `PIE_PI_RUNTIME=bun` selects Bun; unset, `node`, and any other value keep
 * the default Node spawn path. Case-insensitive.
 */
export function parsePiRuntime(value: string | undefined): PiRuntime {
  return value?.trim().toLowerCase() === "bun" ? "bun" : "node";
}

export function isBunCommand(command: string): boolean {
  const base = path.basename(command).toLowerCase();
  return base === "bun" || base === "bun.exe";
}

function resolvePiCliScript(
  env: NodeJS.ProcessEnv,
  resolveBundled: () => string | undefined,
): string | undefined {
  const explicit = env.PIE_PI_EXECUTABLE?.trim();
  if (explicit && JS_CLI_ENTRY.test(explicit)) return explicit;
  return resolveBundled();
}

/**
 * Pick the Pi binary for this process. Priority:
 * 1. `PIE_E2E_PI_EXECUTABLE` when `PIE_E2E=1` (ignores `PIE_PI_RUNTIME`)
 * 2. `PIE_PI_RUNTIME=bun` → `bun <entry>` (owned `pi-rpc.mjs`, or a `.js` /
 *    `.mjs` / `.cjs` `PIE_PI_EXECUTABLE`; never a shebang binary)
 * 3. `PIE_PI_EXECUTABLE`
 * 4. pie-owned `dist/pi-rpc.mjs` via Node (`process.execPath`)
 *
 * Bun is resolved from the user's PATH at spawn / availability time — pie
 * does not ship it. There is no PATH `pi` or npm `cli.js` fallback: the child
 * protocol is pie-owned and a user CLI would drift.
 */
export function resolvePiExecutable(
  env: NodeJS.ProcessEnv = process.env,
  options: ResolvePiExecutableOptions = {},
): PiExecutable {
  if (env.PIE_E2E === "1" && env.PIE_E2E_PI_EXECUTABLE) {
    return { command: env.PIE_E2E_PI_EXECUTABLE, prefixArgs: [] };
  }

  const resolveBundled = options.resolveBundledCli ?? resolvePiRpcEntry;

  if (parsePiRuntime(env.PIE_PI_RUNTIME) === "bun") {
    const script = resolvePiCliScript(env, resolveBundled);
    return { command: "bun", prefixArgs: script === undefined ? [] : [script] };
  }

  const explicit = env.PIE_PI_EXECUTABLE?.trim();
  if (explicit) {
    return { command: explicit, prefixArgs: [] };
  }

  const bundled = resolveBundled();
  if (bundled) {
    return { command: process.execPath, prefixArgs: [bundled] };
  }

  return { command: process.execPath, prefixArgs: [] };
}

/** What `availability` should stat or PATH-search. */
export function piAvailabilityTarget(executable: PiExecutable): string {
  return executable.prefixArgs[0] ?? executable.command;
}

const BUN_MISSING_REASON = "Bun was not found on PATH. Install Bun or unset PIE_PI_RUNTIME.";
const BUN_CLI_MISSING_REASON =
  "Pi RPC entry was not found. PIE_PI_RUNTIME=bun needs the script entry, not a shebang binary.";
const RPC_ENTRY_MISSING_REASON = "Pie's Pi RPC entry is missing.";

export const checkPiAvailability = (
  executable: PiExecutable,
  deps: FindExecutableDeps = {},
): Effect.Effect<
  { available: true } | { available: false; reason: string },
  never,
  FileSystem.FileSystem
> =>
  Effect.gen(function* () {
    if (isBunCommand(executable.command)) {
      const bun = yield* findExecutable(executable.command, deps);
      if (!bun) {
        return { available: false, reason: BUN_MISSING_REASON };
      }
      const script = executable.prefixArgs[0];
      if (script === undefined) {
        return { available: false, reason: BUN_CLI_MISSING_REASON };
      }
      const fileSystem = yield* FileSystem.FileSystem;
      const info = yield* fileSystem.stat(script).pipe(Effect.option);
      if (info._tag === "Some" && info.value.type === "File") {
        return { available: true };
      }
      return { available: false, reason: BUN_CLI_MISSING_REASON };
    }

    // Owned / npm Pi is a JS entry run under Node — npm does not mark it +x.
    if (executable.prefixArgs.length > 0) {
      const script = executable.prefixArgs[0];
      if (script === undefined) {
        return { available: false, reason: RPC_ENTRY_MISSING_REASON };
      }
      const fileSystem = yield* FileSystem.FileSystem;
      const info = yield* fileSystem.stat(script).pipe(Effect.option);
      if (info._tag === "Some" && info.value.type === "File") {
        return { available: true };
      }
      return { available: false, reason: RPC_ENTRY_MISSING_REASON };
    }

    if (executable.command === process.execPath) {
      return { available: false, reason: RPC_ENTRY_MISSING_REASON };
    }

    const found = yield* findExecutable(executable.command, deps);
    return found ? { available: true } : { available: false, reason: RPC_ENTRY_MISSING_REASON };
  });
