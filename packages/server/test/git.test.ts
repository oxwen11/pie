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
    const dir = yield* fs.makeTempDirectoryScoped({ prefix: "pie-git-" });
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

  const addRemoteMain = (dir: string) =>
    Effect.promise(async () => {
      const git = simpleGit(dir);
      const sha = (await git.revparse(["main"])).trim();
      await git.raw(["update-ref", "refs/remotes/origin/main", sha]);
      await git.raw(["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main"]);
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

  it.effect("lists branches and the local default branch", () =>
    Effect.gen(function* () {
      const dir = yield* repo;
      const git = yield* GitService;
      const branch = yield* git.branch(dir);
      assert.equal(branch.current, "main");
      assert.equal(branch.defaultBranch, "main");
      assert.ok(branch.branches.includes("main"));
      assert.deepEqual(branch.remotes, []);
    }).pipe(Effect.provide(GitLayer)),
  );

  it.effect("lists local and remote-tracking refs without fetching", () =>
    Effect.gen(function* () {
      const dir = yield* repo;
      yield* addRemoteMain(dir);
      const git = yield* GitService;
      const branch = yield* git.branch(dir);
      assert.equal(branch.current, "main");
      assert.equal(branch.defaultBranch, "origin/main");
      assert.ok(branch.branches.includes("main"));
      assert.ok(branch.branches.includes("origin/main"));
      assert.ok(branch.branches.includes("origin/HEAD"));
      assert.ok(branch.remotes.includes("origin/main"));
      assert.ok(branch.remotes.includes("origin/HEAD"));
      assert.ok(!branch.remotes.includes("main"));
    }).pipe(Effect.provide(GitLayer)),
  );

  it.effect("defaults review to uncommitted work against HEAD", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const dir = yield* repo;
      yield* fs.writeFileString(path.join(dir, "a.txt"), "hello\n");
      yield* fs.writeFileString(path.join(dir, "added file.txt"), "new");

      const git = yield* GitService;
      const review = yield* git.review({ cwd: dir });
      assert.equal(review.mode, "uncommitted");
      assert.equal(review.other, null);
      assert.equal(review.branch, "main");
      assert.equal(review.base, "HEAD");
      assert.equal(review.baseBranch, null);
      assert.deepEqual(Array.from(review.files.map((file) => file.path)).toSorted(), [
        "a.txt",
        "added file.txt",
      ]);

      const patch = yield* git.patch({ cwd: dir });
      assert.deepEqual(patch.files, review.files);
      assert.deepEqual(patch.issues, []);
      assert.match(patch.patch, /diff --git a\/a\.txt b\/a\.txt/);
      assert.match(patch.patch, /diff --git a\/added file\.txt b\/added file\.txt/);
      assert.match(patch.patch, /new file mode/);
      assert.match(patch.patch, /\+new/);
      assert.match(patch.patch, /No newline at end of file/);

      const modified = yield* git.diff({ cwd: dir, path: "a.txt" });
      assert.equal(modified.status, "modified");
      assert.equal(modified.oldContents, "hi\n");
      assert.equal(modified.newContents, "hello\n");

      const added = yield* git.diff({ cwd: dir, path: "added file.txt" });
      assert.equal(added.status, "added");
      assert.equal(added.oldContents, null);
      assert.equal(added.newContents, "new");
    }).pipe(Effect.provide(GitLayer)),
  );

  it.effect("committed mode diffs HEAD against merge-base and ignores the worktree", () =>
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
      yield* fs.writeFileString(path.join(dir, "wip.txt"), "uncommitted\n");

      const git = yield* GitService;
      const review = yield* git.review({ cwd: dir, mode: "committed" });
      assert.equal(review.mode, "committed");
      assert.equal(review.branch, "feature");
      assert.equal(review.baseBranch, "main");
      assert.notEqual(review.base, "HEAD");
      assert.deepEqual(Array.from(review.files.map((file) => file.path)).toSorted(), [
        "feature.txt",
      ]);

      const patch = yield* git.patch({ cwd: dir, mode: "committed" });
      assert.match(patch.patch, /diff --git a\/feature\.txt b\/feature\.txt/);
      assert.doesNotMatch(patch.patch, /wip\.txt/);

      const diff = yield* git.diff({ cwd: dir, mode: "committed", path: "feature.txt" });
      assert.equal(diff.oldContents, null);
      assert.equal(diff.newContents, "branch\n");
    }).pipe(Effect.provide(GitLayer)),
  );

  it.effect("branch mode includes uncommitted files against a local or remote ref", () =>
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
        const sha = (await git.revparse(["main"])).trim();
        await git.raw(["update-ref", "refs/remotes/origin/main", sha]);
        await git.checkout("feature");
      });
      yield* fs.writeFileString(path.join(dir, "wip.txt"), "uncommitted\n");

      const git = yield* GitService;
      const uncommitted = yield* git.review({ cwd: dir });
      assert.equal(uncommitted.mode, "uncommitted");
      assert.deepEqual(Array.from(uncommitted.files.map((file) => file.path)).toSorted(), [
        "wip.txt",
      ]);

      const vsMain = yield* git.review({ cwd: dir, mode: "branch", other: "main" });
      assert.equal(vsMain.mode, "branch");
      assert.equal(vsMain.other, "main");
      assert.equal(vsMain.baseBranch, "main");
      assert.deepEqual(Array.from(vsMain.files.map((file) => file.path)).toSorted(), [
        "feature.txt",
        "wip.txt",
      ]);
      const patch = yield* git.patch({ cwd: dir, mode: "branch", other: "main" });
      assert.match(patch.patch, /diff --git a\/feature\.txt b\/feature\.txt/);
      assert.match(patch.patch, /diff --git a\/wip\.txt b\/wip\.txt/);

      const vsOrigin = yield* git.review({ cwd: dir, mode: "branch", other: "origin/main" });
      assert.equal(vsOrigin.other, "origin/main");
      assert.deepEqual(Array.from(vsOrigin.files.map((file) => file.path)).toSorted(), [
        "feature.txt",
        "wip.txt",
      ]);
    }).pipe(Effect.provide(GitLayer)),
  );

  it.effect("rejects an unknown or missing compare ref", () =>
    Effect.gen(function* () {
      const dir = yield* repo;
      const git = yield* GitService;

      const missingOther = yield* git.review({ cwd: dir, mode: "branch" }).pipe(Effect.flip);
      assert.equal(missingOther._tag, "GitRefNotFound");

      const unknown = yield* git
        .review({ cwd: dir, mode: "branch", other: "no-such-branch" })
        .pipe(Effect.flip);
      assert.equal(unknown._tag, "GitRefNotFound");
      if (unknown._tag === "GitRefNotFound") assert.equal(unknown.ref, "no-such-branch");

      const unsafe = yield* git
        .review({ cwd: dir, mode: "branch", other: "../main" })
        .pipe(Effect.flip);
      assert.equal(unsafe._tag, "GitRefNotFound");
    }).pipe(Effect.provide(GitLayer)),
  );

  it.effect("diffs a deleted file against the review base", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const dir = yield* repo;
      yield* fs.remove(path.join(dir, "a.txt"));

      const git = yield* GitService;
      const diff = yield* git.diff({ cwd: dir, path: "a.txt" });
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

      const missing = yield* git.review({ cwd: dir }).pipe(Effect.flip);
      assert.equal(missing._tag, "GitNotRepository");
    }).pipe(Effect.provide(GitLayer)),
  );

  it.effect("reports unsupported untracked files and preserves symlinks", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const dir = yield* repo;
      yield* fs.writeFile(path.join(dir, "binary.bin"), Uint8Array.from([0, 1, 2]));
      yield* fs.writeFile(path.join(dir, "staged-binary.bin"), Uint8Array.from([0, 1, 2]));
      yield* Effect.promise(() => simpleGit(dir).add("staged-binary.bin"));
      yield* fs.writeFileString(path.join(dir, "large.txt"), "x".repeat(2 * 1024 * 1024 + 1));
      yield* fs.writeFileString(path.join(dir, "executable.sh"), "#!/bin/sh\n");
      yield* fs.chmod(path.join(dir, "executable.sh"), 0o755);
      yield* fs.writeFileString(path.join(dir, "target.txt"), "private\n");
      yield* fs.symlink("target.txt", path.join(dir, "link.txt"));

      const git = yield* GitService;
      const patch = yield* git.patch({ cwd: dir });

      assert.deepEqual(
        Array.from(patch.issues).toSorted((left, right) => left.path.localeCompare(right.path)),
        [
          { path: "binary.bin", reason: "binary" },
          { path: "large.txt", reason: "too-large" },
          { path: "staged-binary.bin", reason: "binary" },
        ],
      );
      assert.doesNotMatch(patch.patch, /diff --git a\/binary\.bin/);
      assert.doesNotMatch(patch.patch, /diff --git a\/large\.txt/);
      const executablePatch = patch.patch.slice(
        patch.patch.indexOf("diff --git a/executable.sh b/executable.sh"),
        patch.patch.indexOf("diff --git a/link.txt b/link.txt"),
      );
      assert.match(executablePatch, /new file mode 100755/);

      const linkPatch = patch.patch.slice(
        patch.patch.indexOf("diff --git a/link.txt b/link.txt"),
        patch.patch.indexOf("diff --git a/target.txt b/target.txt"),
      );
      assert.match(linkPatch, /new file mode 120000/);
      assert.match(linkPatch, /\+target\.txt/);
      assert.doesNotMatch(linkPatch, /\+private/);
    }).pipe(Effect.provide(GitLayer)),
  );

  it.effect("rejects a tracked patch that exceeds the review payload limit", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const dir = yield* repo;
      yield* fs.writeFileString(path.join(dir, "huge.txt"), "x".repeat(2 * 1024 * 1024 + 1));
      yield* Effect.promise(() => simpleGit(dir).add("huge.txt"));

      const git = yield* GitService;
      const error = yield* git.patch({ cwd: dir }).pipe(Effect.flip);
      assert.equal(error._tag, "GitPatchTooLarge");
    }).pipe(Effect.provide(GitLayer)),
  );

  it.effect("bounds the serialized review response", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const dir = yield* repo;
      yield* fs.writeFileString(path.join(dir, "escaped.txt"), "\x01".repeat(400_000));
      yield* Effect.promise(() => simpleGit(dir).add("escaped.txt"));

      const git = yield* GitService;
      const error = yield* git.patch({ cwd: dir }).pipe(Effect.flip);
      assert.equal(error._tag, "GitPatchTooLarge");
    }).pipe(Effect.provide(GitLayer)),
  );

  it.effect("returns workspace-relative patch paths from a repository subdirectory", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const dir = yield* repo;
      const nested = path.join(dir, "nested");
      yield* fs.makeDirectory(nested);
      yield* fs.writeFileString(path.join(nested, "inside.txt"), "before\n");
      yield* Effect.promise(async () => {
        const git = simpleGit(dir);
        await git.add("nested/inside.txt");
        await git.commit("add nested file");
      });
      yield* fs.writeFileString(path.join(nested, "inside.txt"), "after\n");
      yield* fs.writeFileString(path.join(nested, "untracked.txt"), "new\n");

      const git = yield* GitService;
      const patch = yield* git.patch({ cwd: nested });
      assert.deepEqual(patch.files, [
        { path: "inside.txt", status: "modified" },
        { path: "untracked.txt", status: "added" },
      ]);
      assert.match(patch.patch, /diff --git a\/inside\.txt b\/inside\.txt/);
      assert.match(patch.patch, /diff --git a\/untracked\.txt b\/untracked\.txt/);
      assert.doesNotMatch(patch.patch, /a\/nested\//);
    }).pipe(Effect.provide(GitLayer)),
  );

  it.effect("rejects a path that is not in the review set", () =>
    Effect.gen(function* () {
      const dir = yield* repo;
      const git = yield* GitService;
      const missing = yield* git.diff({ cwd: dir, path: "nope.ts" }).pipe(Effect.flip);
      assert.equal(missing._tag, "WorkspaceFileNotFound");
    }).pipe(Effect.provide(GitLayer)),
  );
});
