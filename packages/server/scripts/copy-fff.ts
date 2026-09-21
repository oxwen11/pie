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

const platformBin = (): string => {
  if (process.platform === "linux") {
    const report = process.report.getReport();
    const glibc =
      "header" in report &&
      typeof report.header === "object" &&
      report.header !== null &&
      "glibcVersionRuntime" in report.header;
    return `@ff-labs/fff-bin-linux-${process.arch}-${glibc ? "gnu" : "musl"}`;
  }
  return `@ff-labs/fff-bin-${process.platform}-${process.arch}`;
};

/** Copy pi-fff + fff-bun + the current platform bin into `dest/node_modules`. */
export function copyFffIsland(dest: string): void {
  const destNodeModules = path.join(dest, "node_modules");
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(destNodeModules, { recursive: true });
  copyPackage("@ff-labs/pi-fff", destNodeModules);
  copyPackage("@ff-labs/fff-bun", destNodeModules);
  copyPackage(platformBin(), destNodeModules);
}
