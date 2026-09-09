import path from "node:path";
import url from "node:url";

import { Effect, FileSystem } from "effect";

import { findExecutable, type FindExecutableDeps } from "../executable";

/** How the server spawns `pi --mode rpc`. */
export type PiExecutable = {
  readonly command: string;
  readonly prefixArgs: ReadonlyArray<string>;
};

/** Host runtime for the Pi RPC child. Default is Node (shebang / `process.execPath`). */
export type PiRuntime = "node" | "bun";

export type ResolvePiExecutableOptions = {
  /** Test seam — production uses {@link resolveBundledPiCli}. */
  readonly resolveBundledCli?: () => string | undefined;
};

const JS_CLI_ENTRY = /\.[cm]?js$/i;

/**
 * Resolve the npm-shipped Pi CLI when `@earendil-works/pi-coding-agent` is on
 * disk next to the running server (desktop asar or global `pie` install).
 */
export function resolveBundledPiCli(): string | undefined {
  try {
    const indexPath = url.fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"));
    return path.join(path.dirname(indexPath), "cli.js");
  } catch {
    return undefined;
  }
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
 * 2. `PIE_PI_RUNTIME=bun` → `bun <cli.js>` (bundled or a `.js` / `.mjs` /
 *    `.cjs` `PIE_PI_EXECUTABLE`; never the shebang `pi` binary)
 * 3. `PIE_PI_EXECUTABLE`
 * 4. bundled `@earendil-works/pi-coding-agent` via Node (`process.execPath`)
 * 5. bare `pi` on PATH
 *
 * Bun is resolved from the user's PATH at spawn / availability time — pie
 * does not ship it.
 */
export function resolvePiExecutable(
  env: NodeJS.ProcessEnv = process.env,
  options: ResolvePiExecutableOptions = {},
): PiExecutable {
  if (env.PIE_E2E === "1" && env.PIE_E2E_PI_EXECUTABLE) {
    return { command: env.PIE_E2E_PI_EXECUTABLE, prefixArgs: [] };
  }

  const resolveBundled = options.resolveBundledCli ?? resolveBundledPiCli;

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

  return { command: "pi", prefixArgs: [] };
}

/** What `availability` should stat or PATH-search. */
export function piAvailabilityTarget(executable: PiExecutable): string {
  return executable.prefixArgs[0] ?? executable.command;
}

const BUN_MISSING_REASON = "Bun was not found on PATH. Install Bun or unset PIE_PI_RUNTIME.";
const BUN_CLI_MISSING_REASON =
  "Pi cli.js was not found. PIE_PI_RUNTIME=bun needs the script entry, not the shebang binary.";

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
      const fs = yield* FileSystem.FileSystem;
      const info = yield* fs.stat(script).pipe(Effect.option);
      if (info._tag === "Some" && info.value.type === "File") {
        return { available: true };
      }
      return { available: false, reason: BUN_CLI_MISSING_REASON };
    }

    // Bundled Pi is a .js entry run under Node — npm does not mark it +x.
    if (executable.prefixArgs.length > 0) {
      const script = executable.prefixArgs[0]!;
      const fs = yield* FileSystem.FileSystem;
      const info = yield* fs.stat(script).pipe(Effect.option);
      if (info._tag === "Some" && info.value.type === "File") {
        return { available: true };
      }
      return { available: false, reason: "Bundled Pi is missing." };
    }

    const found = yield* findExecutable(executable.command, deps);
    return found ? { available: true } : { available: false, reason: "Pi was not found on PATH." };
  });
