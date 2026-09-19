import assert from "node:assert/strict";

import { layer } from "@effect/vitest";
import { Effect, Fiber, Stream } from "effect";

import { NodePlatformLayer } from "../platform";
import { makeFixture, prRef, summary } from "./pull-request-fixture";

layer(NodePlatformLayer)("durable Session associations", (it) => {
  it.effect("registers offline, deduplicates normalized identities and persists cancellation", () =>
    Effect.gen(function* () {
      const f = yield* makeFixture;
      assert.equal(yield* f.service.registerPullRequest(f.ref, prRef), "linked");
      const first = yield* f.service.pullRequestsFor(f.ref);
      assert.equal(
        yield* f.service.registerPullRequest(f.ref, { ...prRef, owner: "GETPIE" }),
        "exists",
      );
      assert.deepEqual(yield* f.service.pullRequestsFor(f.ref), first);
      yield* f.service.excludePullRequest(f.ref, prRef);
      assert.equal(yield* f.service.registerPullRequest(f.ref, prRef, "stack"), "excluded");
      assert.equal(
        (yield* f.stored.read(f.ref.projectId, f.ref.sessionId)).pullRequests?.[0]?.excluded,
        true,
      );
      assert.equal(yield* f.service.registerPullRequest(f.ref, prRef, "agent", true), "linked");
      assert.equal((yield* f.service.pullRequestsFor(f.ref))[0]?.linkedAt, first[0]?.linkedAt);
      assert.equal(f.calls.open, 0);
    }),
  );
  it.effect("rejects late results after cancellation, restore, archive and deletion", () =>
    Effect.gen(function* () {
      const f = yield* makeFixture;
      yield* f.service.registerPullRequest(f.ref, prRef);
      const expected = yield* f.service.pullRequestContextFor(f.ref);
      const updates = expected.links.map((link) => ({ ...link, snapshot: summary }));
      yield* f.service.excludePullRequest(f.ref, prRef);
      assert.equal(yield* f.service.mergePullRequests(f.ref, expected, updates), false);
      yield* f.service.registerPullRequest(f.ref, prRef, "agent", true);
      assert.equal(yield* f.service.mergePullRequests(f.ref, expected, updates), false);
      const restored = yield* f.service.pullRequestContextFor(f.ref);
      yield* f.service.archive(f.ref, true);
      assert.equal(yield* f.service.mergePullRequests(f.ref, restored, updates), false);
      yield* f.service.delete(f.ref);
      assert.equal(
        (yield* Effect.result(f.service.mergePullRequests(f.ref, restored, updates)))._tag,
        "Failure",
      );
      assert.equal(
        (yield* Effect.result(f.stored.read(f.ref.projectId, f.ref.sessionId)))._tag,
        "Failure",
      );
    }),
  );
  it.effect("merges snapshots without losing concurrent title/model or runtime registration", () =>
    Effect.gen(function* () {
      const f = yield* makeFixture;
      yield* f.service.registerPullRequest(f.ref, prRef);
      const expected = yield* f.service.pullRequestContextFor(f.ref);
      yield* Effect.all(
        [
          f.service.rename(f.ref, "New title"),
          f.service.setModel(f.ref, { provider: "test", modelId: "new" }),
          f.service.mergePullRequests(
            f.ref,
            expected,
            expected.links.map((link) => ({ ...link, snapshot: summary })),
          ),
          f.service.registerPullRequest(f.ref, { ...prRef, number: 43 }),
        ],
        { concurrency: "unbounded" },
      );
      yield* f.service.prompt({ ref: f.ref, parts: [{ type: "text", text: "hello" }] });
      yield* f.service.registerPullRequest(f.ref, { ...prRef, number: 44 });
      yield* Effect.yieldNow;
      const metadata = yield* f.repo.read(f.ref.projectId, f.ref.sessionId);
      assert.equal(metadata.title, "New title");
      assert.equal(metadata.modelId, "new");
      assert.equal(metadata.pullRequests?.length, 3);
    }),
  );
  it.effect("reports disk failures and never publishes a saved event", () =>
    Effect.gen(function* () {
      const f = yield* makeFixture;
      const stream = yield* f.bus.subscribe({ kind: "global" });
      const events: string[] = [];
      const drain = yield* stream.pipe(
        Stream.runForEach((message) =>
          Effect.sync(() => {
            if (message.type === "event") events.push(message.event.type);
          }),
        ),
        Effect.forkChild,
      );
      f.failWrite(true);
      assert.equal(
        (yield* Effect.result(f.service.registerPullRequest(f.ref, prRef)))._tag,
        "Failure",
      );
      yield* Effect.yieldNow;
      assert.equal(events.includes("session.pull-requests.updated"), false);
      f.failWrite(false);
      f.failRead(true);
      assert.equal(
        (yield* Effect.result(f.service.registerPullRequest(f.ref, prRef)))._tag,
        "Failure",
      );
      yield* Fiber.interrupt(drain);
    }),
  );
  it.effect("follows checkout changes only in owned worktrees and rejects their late results", () =>
    Effect.gen(function* () {
      const f = yield* makeFixture;
      yield* f.service.registerPullRequest(f.ref, prRef);
      const ordinary = yield* f.service.pullRequestContextFor(f.ref);
      f.setBranch("other-session-branch");
      assert.equal((yield* f.service.pullRequestContextFor(f.ref)).branch, "feature");
      assert.equal(yield* f.service.mergePullRequests(f.ref, ordinary, ordinary.links), true);
      const metadata = yield* f.repo.read(f.ref.projectId, f.ref.sessionId);
      yield* f.repo.write({ ...metadata, ownsWorktree: true });
      const owned = yield* f.service.pullRequestContextFor(f.ref);
      assert.equal(owned.branch, "other-session-branch");
      f.setBranch("next-worktree-branch");
      assert.equal(
        yield* f.service.mergePullRequests(
          f.ref,
          owned,
          owned.links.map((link) => ({ ...link, snapshot: summary })),
        ),
        false,
      );
      assert.equal((yield* f.service.pullRequestsFor(f.ref))[0]?.snapshot, null);
      assert.equal((yield* f.service.pullRequestContextFor(f.ref)).branch, "next-worktree-branch");
    }),
  );
  it.effect("captures ordinary branches and does not delete the Project when creation fails", () =>
    Effect.gen(function* () {
      const f = yield* makeFixture;
      assert.equal((yield* f.service.workspaceFor(f.ref)).gitBranch, "feature");
      f.failWrite(true);
      assert.equal(
        (yield* Effect.result(f.service.create({ projectId: "project", cwd: f.home })))._tag,
        "Failure",
      );
      assert.equal(f.calls.remove, 0);
      assert.equal(f.calls.branch, 2);
    }),
  );
});
