import childProcess from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { resolveDaemonCompatibilityKey } from "./compatibility";

const temporaryDirectories: string[] = [];

function temporaryDirectory(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "pie-core-build-id-"));
  temporaryDirectories.push(directory);
  return directory;
}

function git(cwd: string, ...args: string[]): string {
  return childProcess.execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function repository(): string {
  const cwd = temporaryDirectory();
  git(cwd, "init", "--quiet");
  git(cwd, "config", "user.email", "pie-tests@example.invalid");
  git(cwd, "config", "user.name", "Pie Tests");
  fs.mkdirSync(path.join(cwd, "packages/server/src"), { recursive: true });
  fs.writeFileSync(path.join(cwd, "packages/server/src/tracked.ts"), "initial\n");
  git(cwd, "add", "packages/server/src/tracked.ts");
  git(cwd, "commit", "--quiet", "-m", "initial");
  return cwd;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { force: true, recursive: true });
  }
});

describe("resolveDaemonCompatibilityKey", () => {
  it("uses the first eight characters of HEAD for a clean checkout", () => {
    const cwd = repository();
    expect(resolveDaemonCompatibilityKey({ cwd })).toBe(
      `githash:${git(cwd, "rev-parse", "HEAD").slice(0, 8)}`,
    );
  });

  it("changes when tracked contents change without a commit", () => {
    const cwd = repository();
    const clean = resolveDaemonCompatibilityKey({ cwd });
    fs.writeFileSync(path.join(cwd, "packages/server/src/tracked.ts"), "dirty\n");
    expect(resolveDaemonCompatibilityKey({ cwd })).not.toBe(clean);
  });

  it("changes when an untracked compatibility input changes", () => {
    const cwd = repository();
    const untracked = path.join(cwd, "packages/server/src/untracked.ts");
    fs.writeFileSync(untracked, "first\n");
    const first = resolveDaemonCompatibilityKey({ cwd });
    fs.writeFileSync(untracked, "second\n");
    expect(resolveDaemonCompatibilityKey({ cwd })).not.toBe(first);
  });

  it("changes for daemon build configuration", () => {
    const cwd = repository();
    const clean = resolveDaemonCompatibilityKey({ cwd });
    fs.writeFileSync(path.join(cwd, "packages/server/tsdown.config.ts"), "export default {}\n");
    expect(resolveDaemonCompatibilityKey({ cwd })).not.toBe(clean);
  });

  it("changes for runtime workspace source bundled into the daemon", () => {
    const cwd = repository();
    const clean = resolveDaemonCompatibilityKey({ cwd });
    const contractSource = path.join(cwd, "packages/contract/src/index.ts");
    fs.mkdirSync(path.dirname(contractSource), { recursive: true });
    fs.writeFileSync(contractSource, "export const protocol = 2\n");
    expect(resolveDaemonCompatibilityKey({ cwd })).not.toBe(clean);
  });

  it("changes for shared modules imported by Desktop Main", () => {
    const cwd = repository();
    const clean = resolveDaemonCompatibilityKey({ cwd });
    const sharedSource = path.join(cwd, "apps/desktop/src/shared/desktop-rpc.ts");
    fs.mkdirSync(path.dirname(sharedSource), { recursive: true });
    fs.writeFileSync(sharedSource, "export const channel = 'updated'\n");
    expect(resolveDaemonCompatibilityKey({ cwd })).not.toBe(clean);
  });

  it("ignores dirty files that cannot affect daemon compatibility", () => {
    const cwd = repository();
    const clean = resolveDaemonCompatibilityKey({ cwd });
    fs.writeFileSync(path.join(cwd, "README.md"), "documentation only\n");
    expect(resolveDaemonCompatibilityKey({ cwd })).toBe(clean);
  });

  it("requires a Git checkout", () => {
    expect(() => resolveDaemonCompatibilityKey({ cwd: temporaryDirectory() })).toThrow(
      /Git checkout is required/,
    );
  });
});
