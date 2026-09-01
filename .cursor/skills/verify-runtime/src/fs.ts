import { cpSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";

export function ensureDir(path: string): void {
  mkdirSync(path, { recursive: true });
}

export function readText(path: string): string {
  return readFileSync(path, "utf8");
}

export function writeText(path: string, contents: string): void {
  ensureDir(dirname(path));
  writeFileSync(path, contents);
}

export function readJson<T>(path: string): T {
  return JSON.parse(readText(path)) as T;
}

export function writeJson(path: string, value: unknown): void {
  writeText(path, `${JSON.stringify(value, null, 2)}\n`);
}

export function patchJson(path: string, patch: Record<string, unknown>): void {
  const current = readJson<Record<string, unknown>>(path);
  writeJson(path, { ...current, ...patch });
}

export function readJsonField<T>(path: string, key: string): T {
  const data = readJson<Record<string, unknown>>(path);
  const value = data[key];
  if (value === undefined || value === null) {
    throw new Error(`missing ${key} in ${path}`);
  }
  return value as T;
}

export function tryReadJsonField<T>(path: string, key: string): T | undefined {
  try {
    return readJsonField<T>(path, key);
  } catch {
    return undefined;
  }
}

export function copyDirContents(from: string, to: string): void {
  if (!existsSync(from)) {
    return;
  }
  ensureDir(to);
  cpSync(from, to, { recursive: true });
}

export function removePath(path: string): void {
  rmSync(path, { recursive: true, force: true });
}

export function realPath(path: string): string | undefined {
  try {
    if (!existsSync(path)) {
      return undefined;
    }
    return realpathSync(path);
  } catch {
    return undefined;
  }
}

export function isUnder(parent: string, child: string): boolean {
  const prefix = resolve(parent) + sep;
  return resolve(child).startsWith(prefix);
}

export function isoNow(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function newRunId(): string {
  const stamp = new Date().toISOString().replaceAll(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  return `${stamp}-${process.pid}`;
}

export function tailFile(path: string, lines = 40): void {
  if (!existsSync(path)) {
    return;
  }
  const text = readText(path);
  const slice = text.split("\n").slice(-lines).join("\n");
  process.stderr.write(slice.endsWith("\n") ? slice : `${slice}\n`);
}

export function copyFailureLogs(runDir: string, dest: string): void {
  removePath(dest);
  ensureDir(dest);
  copyDirContents(join(runDir, "logs"), dest);
  const meta = join(runDir, "meta.json");
  if (existsSync(meta)) {
    writeText(join(dest, "meta.json"), readText(meta));
  }
  console.error(`copied logs to ${dest}`);
}

export function currentRun(link: string): string | undefined {
  return realPath(link);
}

export function setCurrentRun(link: string, runDir: string): void {
  ensureDir(dirname(link));
  ensureDir(dirname(runDir));
  rmSync(link, { force: true });
  symlinkSync(runDir, link);
}

export function clearCurrentRun(link: string, runDir: string): void {
  const current = realPath(link);
  if (current === undefined || current === runDir) {
    rmSync(link, { force: true });
  }
}
