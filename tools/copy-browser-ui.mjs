import fs from "node:fs/promises";
import path from "node:path";
import url from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const source = path.join(repoRoot, "apps", "app", "dist");
const targetArgument = process.argv[2];

if (targetArgument === undefined) {
  throw new Error("Usage: node tools/copy-browser-ui.mjs <target-directory>");
}

const index = path.join(source, "index.html");
try {
  await fs.access(index);
} catch {
  throw new Error("Browser UI build is missing apps/app/dist/index.html");
}

const target = path.resolve(process.cwd(), targetArgument);
await fs.rm(target, { recursive: true, force: true });
await fs.mkdir(path.dirname(target), { recursive: true });
await fs.cp(source, target, { recursive: true });
await fs.access(path.join(target, "index.html"));
