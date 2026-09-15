import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { layer } from "@effect/vitest";
import { Effect, FileSystem, Layer } from "effect";
import { simpleGit } from "simple-git";

import { layerPaths } from "../src/config/paths";
import { FileSystemServiceLayer } from "../src/fs";
import { GitService, GitServiceLayer } from "../src/git";
import { WorktreeService, WorktreeServiceLayer } from "../src/git/worktree-service";
import { NodePlatformLayer } from "./platform";

const pieHome = fs.mkdtempSync(path.join(os.tmpdir(), "pie-home-worktree-"));
const pathsLayer = layerPaths(pieHome);
const GitLayer = GitServiceLayer.pipe(Layer.provide(FileSystemServiceLayer));
const WorktreeLayer = WorktreeServiceLayer.pipe(Layer.provide(pathsLayer));

layer(NodePlatformLayer)("WorktreeService", (it) => {
  const repo = Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const dir = yield* fileSystem.makeTempDirectoryScoped({ prefix: "pie-worktree-" });
    yield* fileSystem.writeFileString(path.join(dir, "a.txt"), "hi\n");
    yield* Effect.promise(async () => {
      const git = simpleGit(dir);
      await git.raw(["init", "-b", "main"]);
      await git.addConfig("user.email", "test@example.com");
      await git.addConfig("user.name", "Test");
      await git.add(".");
      await git.commit("init");
    });
    return dir;
  });

  it.effect("creates a worktree on a new branch under $PIE_HOME/worktrees", () =>
    Effect.gen(function* () {
      const dir = yield* repo;
      const worktrees = yield* WorktreeService;
      const git = yield* GitService;
      const created = yield* worktrees.create(dir);
      assert.match(created.branch, /^pie\/[a-f0-9]{8}$/);
      assert.ok(created.path.startsWith(path.join(pieHome, "worktrees")));
      assert.match(created.path, /[\\/][a-z0-9]{4}$/);

      const branch = yield* git.branch(created.path);
      assert.equal(branch.kind, "repository");
      if (branch.kind !== "repository") return;
      assert.equal(branch.current, created.branch);

      const status = yield* git.status(dir);
      assert.equal(status.branch, "main");

      yield* worktrees.remove(created.path);
    }).pipe(Effect.provide(GitLayer), Effect.provide(WorktreeLayer)),
  );

  it.effect("creates a worktree from a specified base ref", () =>
    Effect.gen(function* () {
      const dir = yield* repo;
      const worktrees = yield* WorktreeService;
      const git = yield* GitService;
      yield* Effect.promise(async () => {
        const repoGit = simpleGit(dir);
        await repoGit.checkoutLocalBranch("feature");
        await repoGit.checkout("main");
      });

      const created = yield* worktrees.create(dir, { base: "feature" });
      assert.match(created.branch, /^pie\/[a-f0-9]{8}$/);

      const branch = yield* git.branch(created.path);
      assert.equal(branch.kind, "repository");
      if (branch.kind !== "repository") return;
      assert.equal(branch.current, created.branch);

      const featureContents = yield* Effect.promise(async () => {
        const repoGit = simpleGit(created.path);
        return repoGit.revparse(["HEAD"]);
      });
      const featureHead = yield* Effect.promise(async () => {
        const repoGit = simpleGit(dir);
        return repoGit.revparse(["feature"]);
      });
      assert.equal(featureContents.trim(), featureHead.trim());

      yield* worktrees.remove(created.path);
    }).pipe(Effect.provide(GitLayer), Effect.provide(WorktreeLayer)),
  );
});
