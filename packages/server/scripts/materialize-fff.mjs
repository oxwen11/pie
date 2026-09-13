#!/usr/bin/env node
/**
 * Copy the bundled @ff-labs/pi-fff JS island (no native fff-bin-*) into a
 * real directory so pie-pi-process can load it without bun-build inlining
 * the FFI graph, and without asar. The platform lib is downloaded at
 * server start into $PIE_HOME/vendor/fff/.
 *
 * Usage:
 *   node scripts/materialize-fff.mjs --dest dist/fff
 */
import fs from "node:fs";
import module from "node:module";
import path from "node:path";

const require = module.createRequire(import.meta.url);
const here = import.meta.dirname;
const serverRoot = path.join(here, "..");

const FFF_VERSION = "0.10.6";

const parseArgs = (argv) => {
  const out = { dest: path.join(serverRoot, "dist", "fff") };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--dest" && next) {
      out.dest = path.resolve(next);
      i += 1;
    }
  }
  return out;
};

const packageDirFromEntry = (name, entry) => {
  let current = path.dirname(entry);
  for (;;) {
    const manifest = path.join(current, "package.json");
    if (fs.existsSync(manifest)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(manifest, "utf8"));
        if (parsed.name === name) return current;
      } catch {
        /* keep walking */
      }
    }
    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
};

const resolvePackageDir = (name, paths) => {
  for (const root of paths) {
    const direct = path.join(root, "node_modules", ...name.split("/"));
    if (fs.existsSync(path.join(direct, "package.json"))) return direct;
  }
  try {
    return path.dirname(require.resolve(`${name}/package.json`, { paths }));
  } catch {
    const fromEntry = packageDirFromEntry(name, require.resolve(name, { paths }));
    if (fromEntry) return fromEntry;
    throw new Error(`materialize-fff: cannot resolve ${name}`);
  }
};

/** pnpm places deps next to the package under `<pkg-store>/node_modules`. */
const packageSearchRoot = (packageDir) => {
  const parent = path.dirname(packageDir);
  const grandparent = path.dirname(parent);
  if (path.basename(grandparent) === "node_modules") {
    return path.dirname(grandparent);
  }
  if (path.basename(parent) === "node_modules") {
    return path.dirname(parent);
  }
  return packageDir;
};

const copyPackage = (name, destNodeModules, searchPaths) => {
  const src = fs.realpathSync(resolvePackageDir(name, searchPaths));
  const dest = path.join(destNodeModules, ...name.split("/"));
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.cpSync(src, dest, {
    recursive: true,
    dereference: true,
    filter: (from) => path.basename(from) !== "node_modules",
  });
  return { dest, src };
};

const dependencyNames = (packageDir) => {
  const manifest = JSON.parse(fs.readFileSync(path.join(packageDir, "package.json"), "utf8"));
  return Object.keys(manifest.dependencies ?? {});
};

export function materializeFffIsland(options) {
  const dest = path.resolve(options.dest);
  const destNodeModules = path.join(dest, "node_modules");
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(destNodeModules, { recursive: true });

  const searchPaths = [serverRoot];
  const queued = [
    "@ff-labs/pi-fff",
    "@ff-labs/fff-bun",
    "@sinclair/typebox",
    "@earendil-works/pi-tui",
  ];
  const seen = new Set();

  while (queued.length > 0) {
    const name = queued.shift();
    if (name === undefined || seen.has(name)) continue;
    if (name.startsWith("@ff-labs/fff-bin-")) continue;
    if (name === "@ff-labs/fff-node") continue;
    seen.add(name);
    const copied = copyPackage(name, destNodeModules, searchPaths);
    searchPaths.push(packageSearchRoot(copied.src));
    for (const dep of dependencyNames(copied.dest)) {
      if (dep === "ffi-rs") continue;
      queued.push(dep);
    }
  }

  const entry = path.join(destNodeModules, "@ff-labs", "pi-fff", "src", "index.ts");
  if (!fs.existsSync(entry)) {
    throw new Error(`materialize-fff: missing ${entry}`);
  }
  fs.writeFileSync(
    path.join(dest, "manifest.json"),
    `${JSON.stringify({ version: FFF_VERSION, kind: "js" }, null, 2)}\n`,
  );
  return dest;
}

const invokedDirectly =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === import.meta.filename;

if (invokedDirectly) {
  const args = parseArgs(process.argv.slice(2));
  const dest = materializeFffIsland(args);
  console.log(`materialized fff island at ${dest}`);
}
