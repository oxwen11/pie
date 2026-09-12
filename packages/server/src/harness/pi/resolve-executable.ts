import fs from "node:fs";
import path from "node:path";
import url from "node:url";

import { Effect, FileSystem } from "effect";

import { findExecutable, type FindExecutableDeps } from "../executable";

/** How the server spawns pie-pi-process. */
export type PiExecutable = {
  readonly command: string;
  readonly prefixArgs: ReadonlyArray<string>;
};

export type ResolvePiExecutableOptions = {
  /** Test seam — production uses {@link resolvePiePiProcessEntry}. */
  readonly resolveBundledCli?: () => string | undefined;
};

const JS_PROCESS_ENTRY = /\.[cm]?js$/i;

const ASAR_SEGMENT = `${path.sep}app.asar${path.sep}`;
const ASAR_UNPACKED_SEGMENT = `${path.sep}app.asar.unpacked${path.sep}`;

/**
 * Electron's `import.meta.resolve` reports paths inside `app.asar` even when
 * electron-builder unpacked the file. Electron can read that virtual path;
 * Bun cannot. Map to the real `app.asar.unpacked` sibling.
 */
function asarUnpackedPath(filePath: string): string {
  const index = filePath.indexOf(ASAR_SEGMENT);
  if (index === -1) return filePath;
  return (
    filePath.slice(0, index) + ASAR_UNPACKED_SEGMENT + filePath.slice(index + ASAR_SEGMENT.length)
  );
}

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
 * Resolve pie-pi-process via package exports only: workspace/desktop
 * `@getpie/server/pi-process`, published CLI `@getpie/cli/pi-process`.
 */
export function resolvePiePiProcessEntry(): string | undefined {
  return (
    resolvedPackageFile("@getpie/server/pi-process") ??
    resolvedPackageFile("@getpie/cli/pi-process")
  );
}

export function isBunCommand(command: string): boolean {
  const base = path.basename(command).toLowerCase();
  return base === "bun" || base === "bun.exe";
}

function resolvePiProcessScript(
  env: NodeJS.ProcessEnv,
  resolveBundled: () => string | undefined,
): string | undefined {
  const explicit = env.PIE_PI_EXECUTABLE?.trim();
  if (explicit && JS_PROCESS_ENTRY.test(explicit)) return explicit;
  return resolveBundled();
}

/**
 * Pick pie-pi-process. Priority:
 * 1. `PIE_E2E_PI_EXECUTABLE` when `PIE_E2E=1`
 * 2. `bun <entry>` — `PIE_BUN` if that path exists, else PATH `bun`. Entry is
 *    a `.js` / `.mjs` / `.cjs` `PIE_PI_EXECUTABLE` or the pie-owned bun-build.
 *    Packaged desktop rewrites `app.asar` → `app.asar.unpacked` because Bun
 *    cannot read an asar; extraResources copies sit outside asar.
 *
 * There is no Node spawn path and no PATH `pi` fallback.
 */
export function resolvePiExecutable(
  env: NodeJS.ProcessEnv = process.env,
  options: ResolvePiExecutableOptions = {},
): PiExecutable {
  if (env.PIE_E2E === "1" && env.PIE_E2E_PI_EXECUTABLE) {
    return { command: env.PIE_E2E_PI_EXECUTABLE, prefixArgs: [] };
  }

  const script = resolvePiProcessScript(env, options.resolveBundledCli ?? resolvePiePiProcessEntry);
  return {
    command: existingFile(env.PIE_BUN?.trim()) ?? "bun",
    prefixArgs: script === undefined ? [] : [asarUnpackedPath(script)],
  };
}

/** What `availability` should stat or PATH-search. */
export function piAvailabilityTarget(executable: PiExecutable): string {
  return executable.prefixArgs[0] ?? executable.command;
}

const BUN_MISSING_REASON = "Bun was not found. Install Bun.";
const BUN_PROCESS_MISSING_REASON = "pie-pi-process entry was not found.";

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
        return { available: false, reason: BUN_PROCESS_MISSING_REASON };
      }
      const fileSystem = yield* FileSystem.FileSystem;
      const info = yield* fileSystem.stat(script).pipe(Effect.option);
      if (info._tag === "Some" && info.value.type === "File") {
        return { available: true };
      }
      return { available: false, reason: BUN_PROCESS_MISSING_REASON };
    }

    const found = yield* findExecutable(executable.command, deps);
    return found ? { available: true } : { available: false, reason: BUN_MISSING_REASON };
  });
