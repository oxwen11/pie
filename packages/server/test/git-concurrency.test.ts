import assert from "node:assert/strict";
import path from "node:path";

import { layer } from "@effect/vitest";
import { Effect, FileSystem, Layer } from "effect";
import { vi } from "vitest";

const gitMock = vi.hoisted(() => ({
  active: 0,
  delayMs: 20,
  peak: 0,
  paths: [] as string[],
}));

vi.mock("simple-git", () => ({
  simpleGit: (cwd: string) => ({
    raw: async (args: string[]) => {
      gitMock.active += 1;
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
      gitMock.delayMs = 20;
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

  it.effect("keeps a permit until an interrupted git child settles", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const dir = yield* fs.makeTempDirectoryScoped({ prefix: "pie-git-interrupt-" });
      gitMock.paths = Array.from({ length: 16 }, (_, index) => `file-${index}.txt`);
      gitMock.active = 0;
      gitMock.delayMs = 50;
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
