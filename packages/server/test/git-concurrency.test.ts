import assert from "node:assert/strict";
import path from "node:path";

import { layer } from "@effect/vitest";
import { Effect, FileSystem, Layer } from "effect";
import { vi } from "vitest";

const gitMock = vi.hoisted(() => ({
  active: 0,
  calls: 0,
  delayMs: 20,
  emitPatch: true,
  execCalls: 0,
  peak: 0,
  paths: [] as string[],
}));

vi.mock("node:child_process", () => {
  const execFile = (
    _command: string,
    args: string[],
    _options: object,
    callback: (error: Error | null, stdout: string) => void,
  ) => {
    gitMock.execCalls += 1;
    if (args[0] === "ls-files" || args.includes("--numstat")) {
      callback(null, "");
      return;
    }
    if (args.includes("--name-status")) {
      callback(null, gitMock.paths.map((file) => `M\0${file}\0`).join(""));
      return;
    }
    callback(
      null,
      gitMock.emitPatch
        ? gitMock.paths
            .map(
              (file) =>
                `diff --git a/${file} b/${file}\n--- a/${file}\n+++ b/${file}\n@@ -1 +1 @@\n-old\n+new\n`,
            )
            .join("")
        : "",
    );
  };
  return { default: { execFile }, execFile };
});

vi.mock("simple-git", () => ({
  simpleGit: (cwd: string) => ({
    raw: async (args: string[]) => {
      gitMock.active += 1;
      gitMock.calls += 1;
      gitMock.peak = Math.max(gitMock.peak, gitMock.active);
      await new Promise((resolve) => setTimeout(resolve, gitMock.delayMs));
      gitMock.active -= 1;

      if (args[0] === "rev-parse" && args[1] === "--show-toplevel") return `${cwd}\n`;
      if (args[0] === "rev-parse" && args[1] === "--abbrev-ref") return "main\n";
      if (args[0] === "diff") {
        return gitMock.paths.map((file) => `M\0${file}\0`).join("");
      }
      if (args[0] === "ls-files") return "";
      if (args[0] === "cat-file" && args[1] === "-s") return "4\n";
      if (args[0] === "cat-file" && args[1] === "-p") return "old\n";
      throw new Error(`Unexpected git command: ${args.join(" ")}`);
    },
  }),
}));

import { FileSystemServiceLayer } from "../src/fs";
import { GitService, GitServiceLayer } from "../src/git";
import { NodePlatformLayer } from "./platform";

const GitLayer = GitServiceLayer.pipe(Layer.provide(FileSystemServiceLayer));

layer(NodePlatformLayer)("GitService concurrency", (it) => {
  it.effect("bounds concurrent git child processes across Review diff fanout", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const dir = yield* fs.makeTempDirectoryScoped({ prefix: "pie-git-concurrency-" });
      gitMock.paths = Array.from({ length: 32 }, (_, index) => `file-${index}.txt`);
      gitMock.active = 0;
      gitMock.calls = 0;
      gitMock.delayMs = 20;
      gitMock.emitPatch = true;
      gitMock.execCalls = 0;
      gitMock.peak = 0;
      yield* Effect.forEach(
        gitMock.paths,
        (file) => fs.writeFileString(path.join(dir, file), "new\n"),
        { concurrency: "unbounded" },
      );

      const git = yield* GitService;
      yield* Effect.forEach(gitMock.paths, (file) => git.diff({ cwd: dir, path: file }), {
        concurrency: "unbounded",
      });

      assert.ok(gitMock.peak <= 8, `expected at most 8 git commands, observed ${gitMock.peak}`);
    }).pipe(Effect.provide(GitLayer)),
  );

  it.effect("builds a Review patch with constant Git command count", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const dir = yield* fs.makeTempDirectoryScoped({ prefix: "pie-git-patch-" });
      gitMock.paths = Array.from({ length: 32 }, (_, index) => `file-${index}.txt`);
      gitMock.active = 0;
      gitMock.calls = 0;
      gitMock.delayMs = 0;
      gitMock.emitPatch = true;
      gitMock.execCalls = 0;
      gitMock.peak = 0;
      yield* Effect.forEach(
        gitMock.paths,
        (file) => fs.writeFileString(path.join(dir, file), "new\n"),
        { concurrency: "unbounded" },
      );

      const git = yield* GitService;
      const patch = yield* git.patch({ cwd: dir });

      assert.equal(patch.files.length, 32);
      assert.equal(gitMock.calls + gitMock.execCalls, 6);
    }).pipe(Effect.provide(GitLayer)),
  );

  it.effect("bounds metadata-only Review responses", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const dir = yield* fs.makeTempDirectoryScoped({ prefix: "pie-git-metadata-limit-" });
      gitMock.paths = Array.from(
        { length: 25_000 },
        (_, index) => `file-${index}-${"x".repeat(80)}.txt`,
      );
      gitMock.active = 0;
      gitMock.calls = 0;
      gitMock.delayMs = 0;
      gitMock.emitPatch = false;
      gitMock.execCalls = 0;
      gitMock.peak = 0;

      const git = yield* GitService;
      const error = yield* git.patch({ cwd: dir }).pipe(Effect.flip);

      assert.equal(error._tag, "GitPatchTooLarge");
    }).pipe(Effect.provide(GitLayer)),
  );

  it.effect("keeps a permit until an interrupted git child settles", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const dir = yield* fs.makeTempDirectoryScoped({ prefix: "pie-git-interrupt-" });
      gitMock.paths = Array.from({ length: 16 }, (_, index) => `file-${index}.txt`);
      gitMock.active = 0;
      gitMock.calls = 0;
      gitMock.delayMs = 50;
      gitMock.emitPatch = true;
      gitMock.execCalls = 0;
      gitMock.peak = 0;
      yield* Effect.forEach(
        gitMock.paths,
        (file) => fs.writeFileString(path.join(dir, file), "new\n"),
        { concurrency: "unbounded" },
      );

      const git = yield* GitService;
      const burst = Effect.forEach(gitMock.paths, (file) => git.diff({ cwd: dir, path: file }), {
        concurrency: "unbounded",
      });
      yield* burst.pipe(Effect.timeout(5), Effect.ignore);
      yield* burst;

      assert.ok(gitMock.peak <= 8, `expected at most 8 git commands, observed ${gitMock.peak}`);
    }).pipe(Effect.provide(GitLayer)),
  );
});
