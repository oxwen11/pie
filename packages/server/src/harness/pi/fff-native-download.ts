import childProcess from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { Effect } from "effect";

import { Paths } from "../../config/paths";
import { isBundledFffEnabled } from "./fff";
import {
  FFF_NATIVE_VERSION,
  fffNativeCacheRoot,
  fffNativeLibPath,
  fffNativeTarget,
  resolveFffNativeLib,
  type FffNativeManifest,
  type FffNativeTarget,
} from "./fff-native";

const VENDOR_DIR_MODE = 0o700;

export type FffNativeEnsureResult =
  | { readonly status: "ready"; readonly libPath: string; readonly source: "cache" | "download" }
  | { readonly status: "skipped"; readonly reason: string }
  | { readonly status: "failed"; readonly reason: string };

export type EnsureFffNativeLibOptions = {
  readonly home: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly platform?: string;
  readonly arch?: string;
  /** Test seam — production always uses the locked catalog target. */
  readonly target?: FffNativeTarget;
  readonly fetchImpl?: (input: string) => Promise<Response>;
  readonly extractTar?: (archive: string, dest: string) => void;
};

export function verifyNpmIntegrity(bytes: Uint8Array, integrity: string): boolean {
  const prefix = "sha512-";
  if (!integrity.startsWith(prefix)) return false;
  const expected = integrity.slice(prefix.length);
  const actual = crypto.createHash("sha512").update(bytes).digest("base64");
  return actual === expected;
}

export function verifyShasum(bytes: Uint8Array, shasum: string): boolean {
  return crypto.createHash("sha1").update(bytes).digest("hex") === shasum;
}

const defaultExtractTar = (archive: string, dest: string): void => {
  childProcess.execFileSync("tar", ["-xzf", archive, "-C", dest], { stdio: "pipe" });
};

const stripQuarantine = (filePath: string): void => {
  if (process.platform !== "darwin") return;
  try {
    childProcess.execFileSync("xattr", ["-d", "com.apple.quarantine", filePath], { stdio: "pipe" });
  } catch {
    /* quarantine xattr is absent on unsigned local copies */
  }
};

const writeManifest = (cacheRoot: string, target: FffNativeTarget): void => {
  const manifest: FffNativeManifest = {
    version: FFF_NATIVE_VERSION,
    platform: target.platform,
    arch: target.arch,
    package: target.packageName,
    lib: target.libFile,
    integrity: target.integrity,
    shasum: target.shasum,
  };
  fs.writeFileSync(path.join(cacheRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
};

const installExtractedPackage = (
  extractedPackageDir: string,
  cacheRoot: string,
  target: FffNativeTarget,
): string => {
  const packageDir = path.join(cacheRoot, "node_modules", ...target.packageName.split("/"));
  fs.mkdirSync(path.dirname(packageDir), { recursive: true, mode: VENDOR_DIR_MODE });
  fs.rmSync(packageDir, { recursive: true, force: true });
  fs.cpSync(extractedPackageDir, packageDir, { recursive: true, dereference: true });
  const libPath = path.join(packageDir, target.libFile);
  if (!fs.existsSync(libPath)) {
    throw new Error(`fff native extract missing ${target.libFile}`);
  }
  stripQuarantine(libPath);
  writeManifest(cacheRoot, target);
  return libPath;
};

/**
 * Download the locked platform tarball, verify npm integrity + shasum, and
 * install it as `$PIE_HOME/vendor/fff/node_modules/@ff-labs/fff-bin-*`.
 * No-ops when the cache already satisfies the pin.
 */
export async function ensureFffNativeLib(
  options: EnsureFffNativeLibOptions,
): Promise<FffNativeEnsureResult> {
  const env = options.env ?? process.env;
  if (!isBundledFffEnabled(env)) {
    return { status: "skipped", reason: "PIE_FFF kill switch" };
  }

  const cached = resolveFffNativeLib({
    env,
    home: options.home,
    platform: options.platform,
    arch: options.arch,
  });
  if (cached !== undefined) {
    return { status: "ready", libPath: cached.libPath, source: "cache" };
  }

  const target =
    options.target ??
    fffNativeTarget(options.platform ?? process.platform, options.arch ?? process.arch);
  if (target === undefined) {
    return {
      status: "skipped",
      reason: `unsupported fff target ${options.platform ?? process.platform}-${options.arch ?? process.arch}`,
    };
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const extractTar = options.extractTar ?? defaultExtractTar;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pie-fff-"));
  try {
    const response = await fetchImpl(target.tarball);
    if (!response.ok) {
      return { status: "failed", reason: `download ${response.status}` };
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!verifyNpmIntegrity(bytes, target.integrity) || !verifyShasum(bytes, target.shasum)) {
      return { status: "failed", reason: "checksum mismatch" };
    }

    const archive = path.join(tmp, "package.tgz");
    fs.writeFileSync(archive, bytes);
    const unpacked = path.join(tmp, "unpacked");
    fs.mkdirSync(unpacked, { recursive: true });
    extractTar(archive, unpacked);

    const extractedPackage = fs.existsSync(path.join(unpacked, "package", "package.json"))
      ? path.join(unpacked, "package")
      : unpacked;
    const root = fffNativeCacheRoot(options.home);
    const staging = path.join(path.dirname(root), `fff.${crypto.randomUUID()}`);
    fs.mkdirSync(staging, { recursive: true, mode: VENDOR_DIR_MODE });
    try {
      installExtractedPackage(extractedPackage, staging, target);
      fs.mkdirSync(path.dirname(root), { recursive: true, mode: VENDOR_DIR_MODE });
      fs.rmSync(root, { recursive: true, force: true });
      fs.renameSync(staging, root);
    } catch (cause) {
      fs.rmSync(staging, { recursive: true, force: true });
      throw cause;
    }
    const installed = fffNativeLibPath(options.home, target);
    if (!fs.existsSync(installed)) {
      return { status: "failed", reason: "cache unreadable after install" };
    }
    return { status: "ready", libPath: installed, source: "download" };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return { status: "failed", reason: message };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/**
 * Server-start background job. Never fails the runtime; sessions keep Pi
 * find/grep until a later spawn sees the cache.
 */
export const ensureFffNativeLibEffect = Effect.gen(function* () {
  if (!isBundledFffEnabled(process.env)) return;
  const { home } = yield* Paths;
  const result = yield* Effect.tryPromise({
    try: () => ensureFffNativeLib({ home, env: process.env }),
    catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
  }).pipe(
    Effect.catch((error) =>
      Effect.succeed({
        status: "failed" as const,
        reason: error.message,
      } satisfies FffNativeEnsureResult),
    ),
  );

  switch (result.status) {
    case "ready":
      process.env.FFF_BUN_LIB = result.libPath;
      yield* Effect.logInfo("fff native lib ready").pipe(
        Effect.annotateLogs({
          event: "fff.native_ready",
          source: result.source,
          path: result.libPath,
        }),
      );
      return;
    case "skipped":
      yield* Effect.logInfo("fff native lib skipped").pipe(
        Effect.annotateLogs({ event: "fff.native_skipped", reason: result.reason }),
      );
      return;
    case "failed":
      yield* Effect.logWarning("fff native lib unavailable").pipe(
        Effect.annotateLogs({ event: "fff.native_failed", reason: result.reason }),
      );
      return;
    default: {
      const exhaustive: never = result;
      void exhaustive;
    }
  }
});
