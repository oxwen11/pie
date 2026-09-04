import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { gitContentionTestFiles, serverGitProject, serverParallelProject } from "../vitest.config";

const serverRoot = path.join(import.meta.dirname, "..");

describe("server vitest projects", () => {
  it("isolates a real git-contention set so other test files are not serialized", () => {
    expect(gitContentionTestFiles.length).toBeGreaterThan(0);

    const listed = new Set<string>(gitContentionTestFiles);
    for (const relative of gitContentionTestFiles) {
      const absolute = path.join(serverRoot, relative);
      expect(fs.existsSync(absolute)).toBe(true);
      const source = fs.readFileSync(absolute, "utf8");
      expect(source.includes("simpleGit") || source.includes("worktree")).toBe(true);
    }

    const allTestFiles = collectTestFiles(path.join(serverRoot, "test")).map((file) =>
      path.relative(serverRoot, file),
    );
    const parallelFiles = allTestFiles.filter((file) => !listed.has(file));
    expect(parallelFiles.length).toBeGreaterThan(listed.size);
    expect(allTestFiles).toContain("test/vitest-projects.test.ts");
    expect(listed.has("test/vitest-projects.test.ts")).toBe(false);

    expect(serverParallelProject.test.name).toBe("server");
    expect("fileParallelism" in serverParallelProject.test).toBe(false);
    expect(serverParallelProject.test.exclude).toEqual([...gitContentionTestFiles]);
    expect(serverGitProject.test.name).toBe("server-git");
    expect(serverGitProject.test.fileParallelism).toBe(false);
    expect(serverGitProject.test.include).toEqual([...gitContentionTestFiles]);
  });
});

function collectTestFiles(directory: string): string[] {
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const next = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectTestFiles(next));
      continue;
    }
    if (entry.name.endsWith(".test.ts")) files.push(next);
  }
  return files;
}
