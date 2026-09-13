import fs from "node:fs";
import path from "node:path";

import { resolvePieHome, vendorFffDirectory } from "../../config/paths";

/**
 * Locked `@ff-labs/fff-bin-*` version. The JS island (`@ff-labs/pi-fff`) and
 * this native cache must stay on the same release.
 *
 * Do not import `@ff-labs/fff-bun` from this module — bun-build of
 * pie-pi-process must not inline the native FFI graph.
 */

export const FFF_NATIVE_VERSION = "0.10.6";

export type FffNativeTarget = {
  readonly platform: string;
  readonly arch: string;
  readonly packageName: string;
  readonly libFile: string;
  readonly tarball: string;
  readonly integrity: string;
  readonly shasum: string;
};

const TARGETS: ReadonlyArray<FffNativeTarget> = [
  {
    platform: "darwin",
    arch: "arm64",
    packageName: "@ff-labs/fff-bin-darwin-arm64",
    libFile: "libfff_c.dylib",
    tarball:
      "https://registry.npmjs.org/@ff-labs/fff-bin-darwin-arm64/-/fff-bin-darwin-arm64-0.10.6.tgz",
    integrity:
      "sha512-Y0A1f9/UHYg0ej35rnt8Q2A2DMbBzRa4Fc9WpoBST/oVvWOQ7v5JF5ko7NAapOFM0N5oaB9oey1Hsshs6LIyYA==",
    shasum: "f4fe3a33f30d631ee88754475f7143650cc8c57e",
  },
  {
    platform: "darwin",
    arch: "x64",
    packageName: "@ff-labs/fff-bin-darwin-x64",
    libFile: "libfff_c.dylib",
    tarball:
      "https://registry.npmjs.org/@ff-labs/fff-bin-darwin-x64/-/fff-bin-darwin-x64-0.10.6.tgz",
    integrity:
      "sha512-qQnmQWnotuOne10vtVHoMKTxCSANaJ3a/cegBKvfN8cZCr4b4Vtg51APADh8U3AwsI/k61rJQgjy6BqdBYj3cw==",
    shasum: "71e869564ef0e9ed827a7e36d3e329e218ac9b6d",
  },
  {
    platform: "linux",
    arch: "arm64",
    packageName: "@ff-labs/fff-bin-linux-arm64-gnu",
    libFile: "libfff_c.so",
    tarball:
      "https://registry.npmjs.org/@ff-labs/fff-bin-linux-arm64-gnu/-/fff-bin-linux-arm64-gnu-0.10.6.tgz",
    integrity:
      "sha512-JwfgfwL4V0+tJCc1HW3In++1c+EZLix0ecV/k4b+8DyzSGh3GPZB1i7F4JXQFHVibs71mLeFEJO4owglullZNw==",
    shasum: "438745f6481875644faf98d0cc0b78bf2f722685",
  },
  {
    platform: "linux",
    arch: "x64",
    packageName: "@ff-labs/fff-bin-linux-x64-gnu",
    libFile: "libfff_c.so",
    tarball:
      "https://registry.npmjs.org/@ff-labs/fff-bin-linux-x64-gnu/-/fff-bin-linux-x64-gnu-0.10.6.tgz",
    integrity:
      "sha512-oC8Tlg/+aNbdfEkj4QtVCbrqYUEjQZkP/e1KLwv142+dwjgxHQKQGSIKB67IvP07DKazvUG/0I0YR91dP/ClLA==",
    shasum: "bdaff3560138d2e48125b8f3f6003feb56c0acc2",
  },
  {
    platform: "win32",
    arch: "arm64",
    packageName: "@ff-labs/fff-bin-win32-arm64",
    libFile: "fff_c.dll",
    tarball:
      "https://registry.npmjs.org/@ff-labs/fff-bin-win32-arm64/-/fff-bin-win32-arm64-0.10.6.tgz",
    integrity:
      "sha512-GFfA21vuxcyqZZ2pSq7V5ClAKIVrWLulK5h93wjUc308zyxApY2luJdyIBHtw93UTkJQ079mRMPIthkeCEEn9A==",
    shasum: "09a281b825737614198042f2c5e0cd4fee9511c7",
  },
  {
    platform: "win32",
    arch: "x64",
    packageName: "@ff-labs/fff-bin-win32-x64",
    libFile: "fff_c.dll",
    tarball: "https://registry.npmjs.org/@ff-labs/fff-bin-win32-x64/-/fff-bin-win32-x64-0.10.6.tgz",
    integrity:
      "sha512-EjOHtxRNmZnjrNx2fahiAhP2wLDad6tlLL3cIk3snEzHpP30VygZMcuq3u8fNBZOeHgEPGRnqkfhILQDyblvJQ==",
    shasum: "795317fbc327694766186a922da7749056edb232",
  },
];

const isJsonRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const existingFile = (pathname: string): string | undefined => {
  try {
    return fs.existsSync(pathname) ? pathname : undefined;
  } catch {
    return undefined;
  }
};

/** Walk from a platform lib file up to its `node_modules` directory. */
export function nodeModulesFromLibPath(libPath: string): string | undefined {
  const marker = `${path.sep}node_modules`;
  const index = libPath.lastIndexOf(marker);
  if (index === -1) return undefined;
  const after = libPath.slice(index + marker.length);
  if (after !== "" && !after.startsWith(path.sep)) return undefined;
  return libPath.slice(0, index + marker.length);
}

export function fffNativeTarget(
  platform: string = process.platform,
  arch: string = process.arch,
): FffNativeTarget | undefined {
  const normalizedArch = arch === "ia32" ? "x64" : arch;
  return TARGETS.find((target) => target.platform === platform && target.arch === normalizedArch);
}

export type FffNativeManifest = {
  readonly version: string;
  readonly platform: string;
  readonly arch: string;
  readonly package: string;
  readonly lib: string;
  readonly integrity: string;
  readonly shasum: string;
};

export function fffNativeCacheRoot(home: string): string {
  return vendorFffDirectory(home);
}

export function fffNativeNodeModules(home: string): string {
  return path.join(fffNativeCacheRoot(home), "node_modules");
}

export function fffNativeManifestPath(home: string): string {
  return path.join(fffNativeCacheRoot(home), "manifest.json");
}

export function fffNativePackageDir(home: string, packageName: string): string {
  return path.join(fffNativeNodeModules(home), ...packageName.split("/"));
}

export function fffNativeLibPath(home: string, target: FffNativeTarget): string {
  return path.join(fffNativePackageDir(home, target.packageName), target.libFile);
}

export function readFffNativeManifest(home: string): FffNativeManifest | undefined {
  const file = existingFile(fffNativeManifestPath(home));
  if (file === undefined) return undefined;
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!isJsonRecord(parsed)) return undefined;
    const record = parsed;
    if (
      typeof record.version !== "string" ||
      typeof record.platform !== "string" ||
      typeof record.arch !== "string" ||
      typeof record.package !== "string" ||
      typeof record.lib !== "string" ||
      typeof record.integrity !== "string" ||
      typeof record.shasum !== "string"
    ) {
      return undefined;
    }
    return {
      version: record.version,
      platform: record.platform,
      arch: record.arch,
      package: record.package,
      lib: record.lib,
      integrity: record.integrity,
      shasum: record.shasum,
    };
  } catch {
    return undefined;
  }
}

export type ResolvedFffNative = {
  readonly libPath: string;
  readonly nodeModules?: string;
};

export type ResolveFffNativeOptions = {
  readonly env?: NodeJS.ProcessEnv;
  readonly home?: string;
  readonly platform?: string;
  readonly arch?: string;
};

const resolveCachedFffNativeLib = (
  home: string,
  platform: string,
  arch: string,
): ResolvedFffNative | undefined => {
  const target = fffNativeTarget(platform, arch);
  if (target === undefined) return undefined;

  const manifest = readFffNativeManifest(home);
  if (
    manifest === undefined ||
    manifest.version !== FFF_NATIVE_VERSION ||
    manifest.package !== target.packageName ||
    manifest.integrity !== target.integrity
  ) {
    return undefined;
  }

  const libPath = existingFile(fffNativeLibPath(home, target));
  if (libPath === undefined) return undefined;
  return { libPath, nodeModules: fffNativeNodeModules(home) };
};

/**
 * Prefer an explicit `FFF_BUN_LIB`, then the `$PIE_HOME` cache. Always attach
 * `nodeModules` when we can: `fff-bun`'s `findBinary()` does not read
 * `FFF_BUN_LIB`, it `require.resolve`s the platform package. After the
 * background download the daemon sets `FFF_BUN_LIB` on its own env; spawn
 * must still prepend `$PIE_HOME/vendor/fff/node_modules` onto the child
 * `NODE_PATH`.
 */
export function resolveFffNativeLib(
  options: ResolveFffNativeOptions = {},
): ResolvedFffNative | undefined {
  const env = options.env ?? process.env;
  const home = options.home ?? resolvePieHome(env);
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const cached = resolveCachedFffNativeLib(home, platform, arch);

  const explicit = env.FFF_BUN_LIB?.trim();
  if (explicit) {
    const asFile = existingFile(explicit);
    if (asFile) {
      return {
        libPath: asFile,
        nodeModules: cached?.nodeModules ?? nodeModulesFromLibPath(asFile),
      };
    }
  }

  return cached;
}

export function prependNodePath(current: string | undefined, extra: string): string {
  if (current === undefined || current.trim() === "") return extra;
  const parts = current.split(path.delimiter).filter((entry) => entry.length > 0);
  if (parts.includes(extra)) return current;
  return [extra, ...parts].join(path.delimiter);
}

/**
 * Overlay for `pie-pi-process`. Sets `FFF_BUN_LIB` and prepends the cache
 * `node_modules` to `NODE_PATH` so `fff-bun`'s `require.resolve` finds the
 * platform package. Does not mutate the daemon's own `NODE_PATH`.
 */
export function fffNativeChildEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv | undefined {
  const resolved = resolveFffNativeLib({ env });
  if (resolved === undefined) return undefined;
  if (resolved.nodeModules === undefined) {
    return { FFF_BUN_LIB: resolved.libPath };
  }
  return {
    FFF_BUN_LIB: resolved.libPath,
    NODE_PATH: prependNodePath(env.NODE_PATH, resolved.nodeModules),
  };
}

export function applyFffNativeEnvInPlace(env: NodeJS.ProcessEnv): void {
  const overlay = fffNativeChildEnv(env);
  if (overlay === undefined) return;
  if (overlay.FFF_BUN_LIB !== undefined) env.FFF_BUN_LIB = overlay.FFF_BUN_LIB;
  if (overlay.NODE_PATH !== undefined) env.NODE_PATH = overlay.NODE_PATH;
}
