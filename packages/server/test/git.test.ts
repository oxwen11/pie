import assert from "node:assert/strict";
import path from "node:path";

import { layer } from "@effect/vitest";
import { Effect, FileSystem, Layer } from "effect";
import { simpleGit } from "simple-git";

import { FileSystemServiceLayer } from "../src/fs";
import { GitService, GitServiceLayer } from "../src/git";
import { NodePlatformLayer } from "./platform";

const GitLayer = GitServiceLayer.pipe(Layer.provide(FileSystemServiceLayer));

layer(NodePlatformLayer)("GitService", (it) => {
  /** A repo with one commit on `main`, removed when the test's scope closes. */
  const repo = Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const dir = yield* fs.makeTempDirectoryScoped({ prefix: "vibest-git-" });
    yield* fs.writeFileString(path.join(dir, "a.txt"), "hi\n");
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

  it.effect("reports working-tree status with untracked files", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const dir = yield* repo;
      yield* fs.writeFileString(path.join(dir, "untracked.txt"), "x");

      const git = yield* GitService;
      const status = yield* git.status(dir);
      assert.equal(status.branch, "main");
      assert.ok(status.files.some((file) => file.path === "untracked.txt"));
    }).pipe(Effect.provide(GitLayer)),
  );

  it.effect("lists branches and the default branch", () =>
    Effect.gen(function* () {
      const dir = yield* repo;
      const git = yield* GitService;
      const branch = yield* git.branch(dir);
      assert.equal(branch.current, "main");
      assert.equal(branch.defaultBranch, "main");
      assert.ok(branch.branches.includes("main"));
    }).pipe(Effect.provide(GitLayer)),
  );

  it.effect("reviews uncommitted work on the default branch against HEAD", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const dir = yield* repo;
      yield* fs.writeFileString(path.join(dir, "a.txt"), "hello\n");
      yield* fs.writeFileString(path.join(dir, "added.txt"), "new\n");

      const git = yield* GitService;
      const review = yield* git.review(dir);
      assert.equal(review.branch, "main");
      assert.equal(review.base, "HEAD");
      assert.equal(review.baseBranch, null);
      assert.deepEqual(Array.from(review.files.map((file) => file.path)).toSorted(), [
        "a.txt",
        "added.txt",
      ]);

      const modified = yield* git.diff(dir, "a.txt");
      assert.equal(modified.status, "modified");
      assert.equal(modified.oldContents, "hi\n");
      assert.equal(modified.newContents, "hello\n");

      const added = yield* git.diff(dir, "added.txt");
      assert.equal(added.status, "added");
      assert.equal(added.oldContents, null);
      assert.equal(added.newContents, "new\n");
    }).pipe(Effect.provide(GitLayer)),
  );

  it.effect("reviews a feature branch against merge-base with main", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const dir = yield* repo;
      yield* Effect.promise(async () => {
        const git = simpleGit(dir);
        await git.checkoutLocalBranch("feature");
      });
      yield* fs.writeFileString(path.join(dir, "feature.txt"), "branch\n");
      yield* Effect.promise(async () => {
        const git = simpleGit(dir);
        await git.add("feature.txt");
        await git.commit("feature work");
      });

      const git = yield* GitService;
      const review = yield* git.review(dir);
      assert.equal(review.branch, "feature");
      assert.equal(review.baseBranch, "main");
      assert.notEqual(review.base, "HEAD");
      assert.ok(
        review.files.some((file) => file.path === "feature.txt" && file.status === "added"),
      );

      const diff = yield* git.diff(dir, "feature.txt");
      assert.equal(diff.oldContents, null);
      assert.equal(diff.newContents, "branch\n");
    }).pipe(Effect.provide(GitLayer)),
  );

  it.effect("ignores later main commits when reviewing a feature branch", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const dir = yield* repo;
      yield* Effect.promise(async () => {
        const git = simpleGit(dir);
        await git.checkoutLocalBranch("feature");
      });
      yield* fs.writeFileString(path.join(dir, "feature.txt"), "branch\n");
      yield* Effect.promise(async () => {
        const git = simpleGit(dir);
        await git.add("feature.txt");
        await git.commit("feature work");
        await git.checkout("main");
      });
      yield* fs.writeFileString(path.join(dir, "a.txt"), "main-line\n");
      yield* fs.writeFileString(path.join(dir, "extra.txt"), "only on main\n");
      yield* Effect.promise(async () => {
        const git = simpleGit(dir);
        await git.add(["a.txt", "extra.txt"]);
        await git.commit("main moved forward");
        await git.checkout("feature");
      });
      yield* fs.writeFileString(path.join(dir, "wip.txt"), "uncommitted\n");

      const git = yield* GitService;
      const review = yield* git.review(dir);
      assert.equal(review.branch, "feature");
      assert.equal(review.baseBranch, "main");
      assert.deepEqual(Array.from(review.files.map((file) => file.path)).toSorted(), [
        "feature.txt",
        "wip.txt",
      ]);
    }).pipe(Effect.provide(GitLayer)),
  );

  it.effect("diffs a deleted file against the review base", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const dir = yield* repo;
      yield* fs.remove(path.join(dir, "a.txt"));

      const git = yield* GitService;
      const diff = yield* git.diff(dir, "a.txt");
      assert.equal(diff.status, "deleted");
      assert.equal(diff.oldContents, "hi\n");
      assert.equal(diff.newContents, null);
    }).pipe(Effect.provide(GitLayer)),
  );

  it.effect("rejects a relative cwd and a non-repository", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const dir = yield* fs.makeTempDirectoryScoped({ prefix: "vibest-not-git-" });
      const git = yield* GitService;

      const relative = yield* git.status("relative/workspace").pipe(Effect.flip);
      assert.equal(relative._tag, "WorkspacePathEscape");

      const missing = yield* git.review(dir).pipe(Effect.flip);
      assert.equal(missing._tag, "GitNotRepository");
    }).pipe(Effect.provide(GitLayer)),
  );

  it.effect("rejects a path that is not in the review set", () =>
    Effect.gen(function* () {
      const dir = yield* repo;
      const git = yield* GitService;
      const missing = yield* git.diff(dir, "nope.ts").pipe(Effect.flip);
      assert.equal(missing._tag, "WorkspaceFileNotFound");
    }).pipe(Effect.provide(GitLayer)),
  );
});
