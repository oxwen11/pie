import fs from "node:fs";
import path from "node:path";

import { resolveFffNativeLib, type ResolveFffNativeOptions } from "./fff-native";

/**
 * First-class fff load for pie-pi-process. Resolves the **bundled**
 * `@ff-labs/pi-fff` tree (never `pi install`) and drops a user-installed
 * duplicate so override-mode `find` / `grep` come from one copy.
 *
 * Do not import `@ff-labs/pi-fff` or `@ff-labs/fff-bun` from this module —
 * bun-build of pie-pi-process must not inline the native FFI graph.
 */

const PI_FFF_PACKAGE = "@ff-labs/pi-fff";
const OVERRIDE_MODE = "override";

const existingFile = (pathname: string): string | undefined => {
  try {
    return fs.existsSync(pathname) ? pathname : undefined;
  } catch {
    return undefined;
  }
};

const normalizePath = (filePath: string): string => path.normalize(filePath);

const isSameOrInside = (candidate: string, root: string): boolean => {
  const resolvedCandidate = path.resolve(candidate);
  const resolvedRoot = path.resolve(root);
  return (
    resolvedCandidate === resolvedRoot || resolvedCandidate.startsWith(`${resolvedRoot}${path.sep}`)
  );
};

/** Kill switch only. Unset / any other value keeps the bundled override on. */
export function isBundledFffEnabled(env: NodeJS.ProcessEnv): boolean {
  const raw = env.PIE_FFF;
  return raw !== "0" && raw !== "false";
}

/** Extension loads only when the kill switch is off and the native lib is on disk. */
export function shouldLoadBundledFff(
  env: NodeJS.ProcessEnv,
  native: ResolveFffNativeOptions = {},
): boolean {
  return isBundledFffEnabled(env) && resolveFffNativeLib({ ...native, env }) !== undefined;
}

export function applyBundledFffEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const next: NodeJS.ProcessEnv = { ...env };
  if (next.PI_FFF_MODE === undefined || next.PI_FFF_MODE === "") {
    next.PI_FFF_MODE = OVERRIDE_MODE;
  }
  if (next.FFF_FOLLOW_SYMLINKS === undefined || next.FFF_FOLLOW_SYMLINKS === "") {
    next.FFF_FOLLOW_SYMLINKS = "0";
  }
  return next;
}

export function applyBundledFffEnvInPlace(env: NodeJS.ProcessEnv): void {
  const next = applyBundledFffEnv(env);
  if (env.PI_FFF_MODE !== next.PI_FFF_MODE && next.PI_FFF_MODE !== undefined) {
    env.PI_FFF_MODE = next.PI_FFF_MODE;
  }
  if (
    env.FFF_FOLLOW_SYMLINKS !== next.FFF_FOLLOW_SYMLINKS &&
    next.FFF_FOLLOW_SYMLINKS !== undefined
  ) {
    env.FFF_FOLLOW_SYMLINKS = next.FFF_FOLLOW_SYMLINKS;
  }
}

const followSymlinksEnabled = (env: NodeJS.ProcessEnv): boolean => {
  const raw = env.FFF_FOLLOW_SYMLINKS;
  return raw === "1" || raw === "true";
};

/** Flags applied after the bundled extension loads (`createAgentSessionServices`). */
export function bundledFffExtensionFlags(env: NodeJS.ProcessEnv): Map<string, boolean | string> {
  const applied = applyBundledFffEnv(env);
  return new Map<string, boolean | string>([
    ["fff-mode", applied.PI_FFF_MODE ?? OVERRIDE_MODE],
    ["fff-follow-symlinks", followSymlinksEnabled(applied)],
  ]);
}

const extensionEntryFromPackageDir = (packageDir: string): string | undefined => {
  const indexTs = existingFile(path.join(packageDir, "src", "index.ts"));
  if (indexTs) return indexTs;
  return existingFile(path.join(packageDir, "package.json")) ? packageDir : undefined;
};

const packageDirFromNodeModules = (nodeModules: string): string | undefined =>
  extensionEntryFromPackageDir(path.join(nodeModules, ...PI_FFF_PACKAGE.split("/")));

/**
 * Island layouts next to pie-pi-process:
 * - CLI / server build: `<root>/pi-process/pi-process.js` + `<root>/fff/node_modules`
 * - Desktop extraResources: `<Resources>/pi-process/…` + `<Resources>/fff/…`
 *   or `vendor/fff` beside `vendor/bun`
 */
export function bundledFffCandidatesFromProcess(processEntry: string): string[] {
  const dir = path.dirname(processEntry);
  return [
    path.join(dir, "..", "fff", "node_modules"),
    path.join(dir, "..", "vendor", "fff", "node_modules"),
  ];
}

const findPackageFromAncestors = (startDir: string): string | undefined => {
  let current = path.resolve(startDir);
  for (;;) {
    const fromNodeModules = packageDirFromNodeModules(path.join(current, "node_modules"));
    if (fromNodeModules) return fromNodeModules;
    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
};

export type ResolveBundledFffExtensionOptions = {
  readonly processEntry?: string;
  readonly env?: NodeJS.ProcessEnv;
};

/**
 * Absolute path to the bundled extension entry (`src/index.ts` or the package
 * dir). `PIE_FFF_EXTENSION` wins when that path exists — tests and pack scripts
 * use it; it is not a user-facing opt-in flag.
 */
export function resolveBundledFffExtension(
  options: ResolveBundledFffExtensionOptions = {},
): string | undefined {
  const env = options.env ?? process.env;
  const explicit = env.PIE_FFF_EXTENSION?.trim();
  if (explicit) {
    const asFile = existingFile(explicit);
    if (asFile) return asFile;
    const asPackage = extensionEntryFromPackageDir(explicit);
    if (asPackage) return asPackage;
  }

  const processEntry = options.processEntry ?? import.meta.filename;
  for (const nodeModules of bundledFffCandidatesFromProcess(processEntry)) {
    const found = packageDirFromNodeModules(nodeModules);
    if (found) return found;
  }

  return findPackageFromAncestors(path.dirname(processEntry));
}

const PI_FFF_PATH_MARKERS = [
  `${path.sep}@ff-labs${path.sep}pi-fff${path.sep}`,
  `${path.sep}@ff-labs${path.sep}pi-fff`,
  `${path.sep}packages${path.sep}pi-fff${path.sep}`,
  `${path.sep}packages${path.sep}pi-fff`,
];

export function isPiFffExtensionPath(filePath: string): boolean {
  const normalized = normalizePath(filePath);
  if (
    PI_FFF_PATH_MARKERS.some((marker) => normalized.includes(marker) || normalized.endsWith(marker))
  ) {
    return true;
  }
  return packageNameAt(normalized) === PI_FFF_PACKAGE;
}

const packageNameAt = (filePath: string): string | undefined => {
  let current = path.resolve(filePath);
  if (existingFile(current) && !current.endsWith(`${path.sep}package.json`)) {
    current = path.dirname(current);
  }
  for (;;) {
    const manifest = path.join(current, "package.json");
    if (existingFile(manifest)) {
      try {
        const parsed: unknown = JSON.parse(fs.readFileSync(manifest, "utf8"));
        if (
          typeof parsed === "object" &&
          parsed !== null &&
          "name" in parsed &&
          typeof parsed.name === "string"
        ) {
          return parsed.name;
        }
      } catch {
        return undefined;
      }
    }
    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
};

export type LoadedExtensionPaths = {
  readonly path: string;
  readonly resolvedPath: string;
};

export type ExtensionsLoadResult<T extends LoadedExtensionPaths> = {
  readonly extensions: ReadonlyArray<T>;
  readonly errors: ReadonlyArray<{ readonly path: string; readonly error: string }>;
};

/** Keep the bundled copy; drop any other pi-fff (typically `pi install`). */
export function withoutUserInstalledPiFff<
  T extends LoadedExtensionPaths,
  R extends ExtensionsLoadResult<T>,
>(result: R, bundledPath: string): R {
  const bundled = path.resolve(bundledPath);
  const keep = (filePath: string): boolean => {
    if (!isPiFffExtensionPath(filePath)) return true;
    return isSameOrInside(filePath, bundled);
  };
  return {
    ...result,
    extensions: result.extensions.filter(
      (extension) => keep(extension.resolvedPath) || keep(extension.path),
    ),
    errors: result.errors.filter(
      (error) => keep(error.path) || isSameOrInside(error.path, bundled),
    ),
  };
}
