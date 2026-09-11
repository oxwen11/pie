import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { traceNodeModules } from "nf3";

const PI_PACKAGE = "@earendil-works/pi-coding-agent";
const SERVER_PACKAGE = "@getpie/server";

const FALLBACK_GLOBS = [
  "**/node_modules/@earendil-works/pi-coding-agent/**",
  "**/node_modules/@getpie/server/dist/pi-rpc.mjs",
];

function resolvePackageDir(name: string, fromDir: string): string | undefined {
  let dir = fs.realpathSync(path.resolve(fromDir));
  while (true) {
    const candidate = path.join(dir, "node_modules", name, "package.json");
    if (fs.existsSync(candidate)) return fs.realpathSync(path.dirname(candidate));
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/** Pie-owned RPC child (`dist/pi-rpc.mjs`). Undefined before the server build. */
export function resolvePiRpcJs(fromDir: string): string | undefined {
  const serverDir = resolvePackageDir(SERVER_PACKAGE, fromDir);
  if (serverDir === undefined) return undefined;
  const dist = path.join(serverDir, "dist", "pi-rpc.mjs");
  return fs.existsSync(dist) ? dist : undefined;
}

const NAMES_ONLY = "pie-nf3-names-only";

async function tracePi(fromDir: string, outDir: string, copy: boolean): Promise<Set<string>> {
  const entry = resolvePiRpcJs(fromDir);
  if (entry === undefined) {
    throw new Error("Pi RPC entry missing; build @getpie/server first");
  }
  const serverDir = resolvePackageDir(SERVER_PACKAGE, fromDir) ?? fromDir;
  let packages = new Set<string>();
  try {
    await traceNodeModules([entry], {
      rootDir: serverDir,
      outDir,
      fullTraceInclude: [PI_PACKAGE],
      hooks: {
        tracedPackages(traced) {
          packages = new Set(Object.keys(traced));
          if (!copy) throw new Error(NAMES_ONLY);
        },
      },
    });
  } catch (error) {
    if (!(error instanceof Error) || error.message !== NAMES_ONLY) throw error;
  }
  if (!packages.has(PI_PACKAGE)) {
    throw new Error(`nf3 did not trace ${PI_PACKAGE} from ${entry}`);
  }
  return packages;
}

/** Copy the nf3-traced Pi RPC runtime into `outDir/node_modules`. */
export async function unpackPiNodeModules(fromDir: string, outDir: string): Promise<string> {
  const entry = resolvePiRpcJs(fromDir);
  if (entry === undefined) {
    throw new Error("Pi RPC entry missing; build @getpie/server first");
  }
  await tracePi(fromDir, outDir, true);
  const destEntry = path.join(outDir, "node_modules", SERVER_PACKAGE, "dist", "pi-rpc.mjs");
  fs.mkdirSync(path.dirname(destEntry), { recursive: true });
  fs.copyFileSync(entry, destEntry);
  return destEntry;
}

/**
 * asarUnpack globs for packages nf3 traces from pie-owned `pi-rpc.mjs`.
 * `fullTraceInclude` keeps Pi JSON/native assets. electron-builder writes
 * matching files only to app.asar.unpacked, not the asar body.
 */
export async function piAsarUnpackGlobs(fromDir: string): Promise<string[]> {
  if (resolvePiRpcJs(fromDir) === undefined) return FALLBACK_GLOBS;
  const packages = await tracePi(fromDir, os.tmpdir(), false);
  const globs = [...packages].map((name) => `**/node_modules/${name}/**`);
  globs.push("**/node_modules/@getpie/server/dist/pi-rpc.mjs");
  return globs.sort();
}
