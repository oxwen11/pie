import assert from "node:assert/strict";

import { layer } from "@effect/vitest";
import { Effect } from "effect";

import { GitNotRepository } from "../../src/errors";
import { NodePlatformLayer } from "../platform";
import { run } from "./session-service-fixture";

layer(NodePlatformLayer)("PiAgentSessionService worktree create", (it) => {
  it.effect("creates a worktree at create and does not recreate it on prompt", () =>
    Effect.gen(function* () {
      let creates = 0;
      const bases: Array<string | undefined> = [];
      const result = yield* run(
        {
          worktreeCreate: (_cwd, input) => {
            creates += 1;
            bases.push(input?.base);
            return Effect.succeed({
              path: "/tmp/pie-worktree",
              branch: "pie/abcd1234",
            });
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
            for (let attempt = 0; attempt < 1000; attempt += 1) {
              if (fixture.spy.open.length > 0) break;
              yield* Effect.yieldNow;
            }
            return { created, afterCreate, open: fixture.spy.open.slice() };
          }),
      );
      assert.equal(creates, 1);
      assert.deepEqual(bases, ["main"]);
      assert.deepEqual(result.created.workspace, {
        cwd: "/tmp/pie-worktree",
        gitBranch: "pie/abcd1234",
      });
      assert.equal(result.afterCreate.cwd, "/tmp/pie-worktree");
      assert.equal(result.afterCreate.gitBranch, "pie/abcd1234");
      assert.deepEqual(result.open, [{ cwd: "/tmp/pie-worktree" }]);
    }),
  );

  it.effect("does not persist a session when worktree creation fails", () =>
    Effect.gen(function* () {
      const result = yield* run(
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
      assert.equal(result.error._tag, "GitNotRepository");
      assert.equal(result.listed.length, 0);
      assert.deepEqual(result.open, []);
    }),
  );

  it.effect("does not create a worktree when create omits worktree", () =>
    Effect.gen(function* () {
      const stored = yield* run({}, (fixture) =>
        Effect.gen(function* () {
          const created = yield* fixture.service.create({
            projectId: "proj-a",
            cwd: "/tmp/pie-app",
          });
          yield* fixture.service.prompt({
            ref: created.ref,
            parts: [{ type: "text", text: "one" }],
          });
          yield* Effect.yieldNow;
          const afterPrompt = yield* fixture.repo.read(
            created.ref.projectId,
            created.ref.sessionId,
          );
          return { created, afterPrompt };
        }),
      );
      assert.deepEqual(stored.created.workspace, { cwd: "/tmp/pie-app" });
      assert.equal(stored.afterPrompt.cwd, "/tmp/pie-app");
      assert.equal(stored.afterPrompt.gitBranch, undefined);
    }),
  );

  it.effect("removes the worktree when persist fails after create", () =>
    Effect.gen(function* () {
      const removed: string[] = [];
      const result = yield* run(
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
      assert.equal(result.error._tag, "StoreWriteError");
      assert.equal(result.listed.length, 0);
      assert.deepEqual(removed, ["/tmp/pie-worktree"]);
    }),
  );

  it.effect("workspaceFor backfills cwd without writing metadata", () =>
    Effect.gen(function* () {
      const result = yield* run({}, (fixture) =>
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
      assert.deepEqual(result.workspace, { cwd: "/tmp/pie-app" });
      assert.equal(result.cwd, undefined);
    }),
  );
});
