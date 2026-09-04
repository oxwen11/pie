import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { GitNotRepository } from "../../src/errors";
import {
  type Fixture,
  run as runFixture,
  type SessionServiceRunOpts,
} from "./session-service-fixture";

describe("PiAgentSessionService worktree create", () => {
  let home: string;
  beforeEach(async () => {
    home = await fs.mkdtemp(path.join(os.tmpdir(), "pie-svc-wt-"));
  });
  afterEach(async () => {
    await fs.rm(home, { recursive: true, force: true });
  });

  const run = <A, E>(
    opts: SessionServiceRunOpts,
    program: (fixture: Fixture) => Effect.Effect<A, E>,
  ) => runFixture(home, opts, program);

  it("creates a worktree at create and does not recreate it on prompt", async () => {
    let creates = 0;
    const bases: Array<string | undefined> = [];
    const ensured: Array<{ repoCwd: string; path: string; branch: string }> = [];
    const result = await run(
      {
        worktreeCreate: (_cwd, input) => {
          creates += 1;
          bases.push(input?.base);
          return Effect.succeed({
            path: "/tmp/pie-worktree",
            branch: "pie/abcd1234",
          });
        },
        worktreeEnsure: (repoCwd, worktreePath, branch) => {
          ensured.push({ repoCwd, path: worktreePath, branch });
          return Effect.succeed({ path: worktreePath, branch });
        },
      },
      (fixture) =>
        Effect.gen(function* () {
          const created = yield* fixture.service.create({
            projectId: "proj-a",
            cwd: "/tmp/pie-app",
            worktree: { base: "main" },
          });
          const afterCreate = yield* fixture.repo.read(
            created.ref.projectId,
            created.ref.sessionId,
          );
          yield* fixture.service.prompt({
            ref: created.ref,
            parts: [{ type: "text", text: "one" }],
          });
          yield* Effect.sleep("80 millis");
          return { created, afterCreate, open: fixture.spy.open };
        }),
    );
    expect(creates).toBe(1);
    expect(bases).toEqual(["main"]);
    expect(ensured).toEqual([
      { repoCwd: "/tmp/pie-app", path: "/tmp/pie-worktree", branch: "pie/abcd1234" },
    ]);
    expect(result.created.workspace).toEqual({
      cwd: "/tmp/pie-worktree",
      worktree: { branch: "pie/abcd1234" },
    });
    expect(result.afterCreate.cwd).toBe("/tmp/pie-worktree");
    expect(result.afterCreate.worktree).toEqual({ branch: "pie/abcd1234" });
    expect(result.open).toEqual([{ cwd: "/tmp/pie-worktree" }]);
  });

  it("recreates the worktree on prepare from the stored worktree branch", async () => {
    const ensured: Array<{ repoCwd: string; path: string; branch: string }> = [];
    const result = await run(
      {
        worktreeCreate: () =>
          Effect.succeed({
            path: "/tmp/pie-worktree",
            branch: "pie/abcd1234",
          }),
        worktreeEnsure: (repoCwd, worktreePath, branch) => {
          ensured.push({ repoCwd, path: worktreePath, branch });
          return Effect.succeed({ path: worktreePath, branch });
        },
      },
      (fixture) =>
        Effect.gen(function* () {
          const created = yield* fixture.service.create({
            projectId: "proj-a",
            cwd: "/tmp/pie-app",
            worktree: {},
          });
          yield* fixture.service.archive(created.ref, true);
          const workspace = yield* fixture.service.prepare(created.ref);
          return { created, workspace };
        }),
    );
    expect(ensured).toEqual([
      { repoCwd: "/tmp/pie-app", path: "/tmp/pie-worktree", branch: "pie/abcd1234" },
    ]);
    expect(result.workspace).toEqual(result.created.workspace);
  });

  it("does not persist a session when worktree creation fails", async () => {
    const result = await run(
      {
        worktreeCreate: () => Effect.fail(new GitNotRepository({ cwd: "/tmp/pie-app" })),
      },
      (fixture) =>
        Effect.gen(function* () {
          const error = yield* Effect.flip(
            fixture.service.create({
              projectId: "proj-a",
              cwd: "/tmp/pie-app",
              worktree: {},
            }),
          );
          const listed = yield* fixture.repo.list("proj-a");
          return { error, listed, open: fixture.spy.open };
        }),
    );
    expect(result.error._tag).toBe("GitNotRepository");
    expect(result.listed).toHaveLength(0);
    expect(result.open).toEqual([]);
  });

  it("does not create a worktree when create omits worktree", async () => {
    const stored = await run({}, (fixture) =>
      Effect.gen(function* () {
        const created = yield* fixture.service.create({
          projectId: "proj-a",
          cwd: "/tmp/pie-app",
        });
        yield* fixture.service.prompt({ ref: created.ref, parts: [{ type: "text", text: "one" }] });
        yield* Effect.sleep("80 millis");
        const afterPrompt = yield* fixture.repo.read(created.ref.projectId, created.ref.sessionId);
        return { created, afterPrompt };
      }),
    );
    expect(stored.created.workspace).toEqual({ cwd: "/tmp/pie-app" });
    expect(stored.afterPrompt.cwd).toBe("/tmp/pie-app");
    expect(stored.afterPrompt.worktree).toBeUndefined();
  });

  it("removes the worktree when persist fails after create", async () => {
    const removed: string[] = [];
    const result = await run(
      {
        failWrite: true,
        worktreeCreate: () =>
          Effect.succeed({
            path: "/tmp/pie-worktree",
            branch: "pie/abcd1234",
          }),
        worktreeRemove: (worktreePath) => {
          removed.push(worktreePath);
          return Effect.void;
        },
      },
      (fixture) =>
        Effect.gen(function* () {
          const error = yield* Effect.flip(
            fixture.service.create({
              projectId: "proj-a",
              cwd: "/tmp/pie-app",
              worktree: {},
            }),
          );
          const listed = yield* fixture.repo.list("proj-a");
          return { error, listed };
        }),
    );
    expect(result.error._tag).toBe("StoreWriteError");
    expect(result.listed).toHaveLength(0);
    expect(removed).toEqual(["/tmp/pie-worktree"]);
  });

  it("workspaceFor backfills cwd without writing metadata", async () => {
    const result = await run({}, (fixture) =>
      Effect.gen(function* () {
        const { ref } = yield* fixture.service.create({
          projectId: "proj-a",
          cwd: "/tmp/pie-app",
        });
        const stored = yield* fixture.repo.read(ref.projectId, ref.sessionId);
        const { cwd: _dropped, ...withoutCwd } = stored;
        yield* fixture.repo.write(withoutCwd);
        const workspace = yield* fixture.service.workspaceFor(ref);
        const after = yield* fixture.repo.read(ref.projectId, ref.sessionId);
        return { workspace, cwd: after.cwd };
      }),
    );
    expect(result.workspace).toEqual({ cwd: "/tmp/pie-app" });
    expect(result.cwd).toBeUndefined();
  });
});
