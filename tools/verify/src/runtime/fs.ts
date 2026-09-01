import fs from "node:fs";
import path from "node:path";

export function ensureDir(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });
}

export function readText(filePath: string): string {
  return fs.readFileSync(filePath, "utf8");
}

export function writeText(filePath: string, contents: string): void {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, contents);
}

export function readJson<T>(filePath: string): T {
  return JSON.parse(readText(filePath)) as T;
}

export function writeJson(filePath: string, value: unknown): void {
  writeText(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export function patchJson(filePath: string, patch: Record<string, unknown>): void {
  const current = readJson<Record<string, unknown>>(filePath);
  writeJson(filePath, { ...current, ...patch });
}

export function readJsonField<T>(filePath: string, key: string): T {
  const data = readJson<Record<string, unknown>>(filePath);
  const value = data[key];
  if (value === undefined || value === null) {
    throw new Error(`missing ${key} in ${filePath}`);
  }
  return value as T;
}

export function tryReadJsonField<T>(filePath: string, key: string): T | undefined {
  try {
    return readJsonField<T>(filePath, key);
  } catch {
    return undefined;
  }
}

export function copyDirContents(from: string, to: string): void {
  if (!fs.existsSync(from)) {
    return;
  }
  ensureDir(to);
  fs.cpSync(from, to, { recursive: true });
}

export function removePath(target: string): void {
  fs.rmSync(target, { recursive: true, force: true });
}

export function realPath(target: string): string | undefined {
  try {
    if (!fs.existsSync(target)) {
      return undefined;
    }
    return fs.realpathSync(target);
  } catch {
    return undefined;
  }
}

export function isUnder(parent: string, child: string): boolean {
  const prefix = path.resolve(parent) + path.sep;
  return path.resolve(child).startsWith(prefix);
}

export function isoNow(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function newRunId(): string {
  const stamp = new Date()
    .toISOString()
    .replaceAll(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
  return `${stamp}-${process.pid}`;
}

export function tailFile(filePath: string, lines = 40): void {
  if (!fs.existsSync(filePath)) {
    return;
  }
  const text = readText(filePath);
  const slice = text.split("\n").slice(-lines).join("\n");
  process.stderr.write(slice.endsWith("\n") ? slice : `${slice}\n`);
}

export function copyFailureLogs(runDir: string, dest: string): void {
  removePath(dest);
  ensureDir(dest);
  copyDirContents(path.join(runDir, "logs"), dest);
  const meta = path.join(runDir, "meta.json");
  if (fs.existsSync(meta)) {
    writeText(path.join(dest, "meta.json"), readText(meta));
  }
  console.error(`copied logs to ${dest}`);
}

export function currentRun(link: string): string | undefined {
  return realPath(link);
}

export function setCurrentRun(link: string, runDir: string): void {
  ensureDir(path.dirname(link));
  ensureDir(path.dirname(runDir));
  fs.rmSync(link, { force: true });
  fs.symlinkSync(runDir, link);
}

export function clearCurrentRun(link: string, runDir: string): void {
  const current = realPath(link);
  if (current === undefined || current === runDir) {
    fs.rmSync(link, { force: true });
  }
}
