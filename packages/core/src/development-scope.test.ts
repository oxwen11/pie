import childProcess from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { developmentScopeForRoot, resolveGitCheckout } from "./development-scope";

const roots: string[] = [];

function root(...segments: string[]): string {
  const directory = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "pie-dev-scope-")),
    ...segments,
  );
  fs.mkdirSync(directory, { recursive: true });
  roots.push(directory.split(path.sep).slice(0, -segments.length).join(path.sep));
  return directory;
}

afterEach(() => {
  for (const directory of roots.splice(0)) {
    fs.rmSync(directory, { force: true, recursive: true });
  }
});

describe("development daemon scope", () => {
  it("distinguishes checkouts with the same basename", () => {
    const first = root("one", "pie");
    const second = root("two", "pie");
    expect(developmentScopeForRoot(first)).not.toBe(developmentScopeForRoot(second));
  });
});

describe("resolveGitCheckout", () => {
  it("reads the current branch and a detached SHA", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "pie-git-branch-"));
    roots.push(directory);
    git(directory, ["init", "-b", "main"]);
    git(directory, ["config", "user.email", "test@example.com"]);
    git(directory, ["config", "user.name", "Test"]);
    git(directory, ["config", "commit.gpgsign", "false"]);
    fs.writeFileSync(path.join(directory, "a.txt"), "a\n");
    git(directory, ["add", "."]);
    git(directory, ["commit", "-m", "init"]);
    expect(resolveGitCheckout(directory)).toEqual({ inGit: true, branch: "main" });

    git(directory, ["checkout", "-b", "feat/foo"]);
    expect(resolveGitCheckout(directory)).toEqual({ inGit: true, branch: "feat/foo" });

    const sha = git(directory, ["rev-parse", "--short=8", "HEAD"]);
    git(directory, ["checkout", "--detach", "HEAD"]);
    expect(resolveGitCheckout(directory)).toEqual({ inGit: true, branch: sha });
  });

  it("reports inGit false outside a Git checkout", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "pie-not-git-"));
    roots.push(directory);
    expect(resolveGitCheckout(directory)).toEqual({ inGit: false });
  });
});

function git(cwd: string, args: string[]): string {
  return childProcess
    .execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    })
    .trim();
}
