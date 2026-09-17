import fs from "node:fs";
import module from "node:module";
import path from "node:path";

const require = module.createRequire(import.meta.url);
const search = [path.join(import.meta.dirname, "..")];

const packageDir = (name: string): string => {
  try {
    return fs.realpathSync(
      path.dirname(require.resolve(`${name}/package.json`, { paths: search })),
    );
  } catch {
    /* package.json is not exported */
  }
  let current = path.dirname(fs.realpathSync(require.resolve(name, { paths: search })));
  for (;;) {
    const manifest = path.join(current, "package.json");
    if (fs.existsSync(manifest)) {
      const parsed: unknown = JSON.parse(fs.readFileSync(manifest, "utf8"));
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        "name" in parsed &&
        typeof parsed.name === "string" &&
        parsed.name === name
      ) {
        return current;
      }
    }
    const parent = path.dirname(current);
    if (parent === current) throw new Error(`copy-fff: cannot resolve ${name}`);
    current = parent;
  }
};

const copyPackage = (name: string, destNodeModules: string) => {
  const src = packageDir(name);
  search.push(src);
  const dest = path.join(destNodeModules, ...name.split("/"));
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.cpSync(src, dest, {
    recursive: true,
    dereference: true,
    filter: (from) => path.basename(from) !== "node_modules",
  });
};

/** Copy pi-fff + fff-bun + the installed platform bin into `dest/node_modules`. */
export function copyFffIsland(dest: string): void {
  const destNodeModules = path.join(dest, "node_modules");
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(destNodeModules, { recursive: true });
  copyPackage("@ff-labs/pi-fff", destNodeModules);
  copyPackage("@ff-labs/fff-bun", destNodeModules);
  const bunManifest: unknown = JSON.parse(
    fs.readFileSync(path.join(destNodeModules, "@ff-labs", "fff-bun", "package.json"), "utf8"),
  );
  const optional =
    typeof bunManifest === "object" &&
    bunManifest !== null &&
    "optionalDependencies" in bunManifest &&
    typeof bunManifest.optionalDependencies === "object" &&
    bunManifest.optionalDependencies !== null
      ? bunManifest.optionalDependencies
      : {};
  for (const name of Object.keys(optional)) {
    if (!name.startsWith("@ff-labs/fff-bin-")) continue;
    try {
      copyPackage(name, destNodeModules);
    } catch {
      /* other platforms are not installed */
    }
  }
}
