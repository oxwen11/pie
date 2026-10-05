import assert from "node:assert/strict";

import { layer } from "@effect/vitest";
import type { SessionRef } from "@getpie/contract";
import { Clock, Deferred, Effect, Fiber } from "effect";
import { TestClock } from "effect/testing";

import {
  makePullRequestCoordinator,
  type PullRequestSummaryReader,
} from "../src/pull-request/coordinator";
import { PullRequestHostUnavailable, PullRequestUnauthenticated } from "../src/pull-request/errors";
import { makeFixture, prRef, summary } from "./harness/pull-request-fixture";
import { NodePlatformLayer } from "./platform";

const setup = (reader?: Partial<PullRequestSummaryReader>) =>
  Effect.gen(function* () {
    const f = yield* makeFixture;
    let reads = 0,
      discoveries = 0,
      stacks = 0;
    const github: PullRequestSummaryReader = {
      summary: (cwd, ref) =>
        Effect.sync(() => {
          reads++;
        }).pipe(
          Effect.andThen(
            reader?.summary?.(cwd, ref) ??
              Clock.currentTimeMillis.pipe(
                Effect.map((now) => ({ ...summary, ref, checkedAt: new Date(now).toISOString() })),
              ),
          ),
        ),
      discover: (cwd, branch) =>
        Effect.sync(() => {
          discoveries++;
        }).pipe(Effect.andThen(reader?.discover?.(cwd, branch) ?? Effect.succeed(null))),
      stack: (cwd, ref) =>
        Effect.sync(() => {
          stacks++;
        }).pipe(Effect.andThen(reader?.stack?.(cwd, ref) ?? Effect.succeed(null))),
    };
    const coordinator = yield* makePullRequestCoordinator({
      sessions: f.service,
      github,
      bus: f.bus,
      newLeaseId: f.newLeaseId,
      projectPathFor: () => Effect.succeed(f.home),
    });
    return { ...f, github, coordinator, count: () => ({ reads, discoveries, stacks }) };
  });
const settle = TestClock.adjust("1 second");
// TestClock controls scheduler deadlines, not the real temporary filesystem.
// Await a durable completed cycle before advancing its next deadline.
const waitForCycle = (
  f: Effect.Success<ReturnType<typeof setup>>,
  reads: number,
  stacks?: number,
  refs: readonly SessionRef[] = [f.ref],
) =>
  Effect.gen(function* () {
    for (let attempt = 0; attempt < 500; attempt++) {
      const statuses = yield* f.coordinator.statuses(refs);
      if (
        statuses.every((status) => status.state === "ready") &&
        f.count().reads === reads &&
        (stacks === undefined || f.count().stacks === stacks)
      )
        return;
      yield* Effect.promise(
        () =>
          new Promise<void>((resolve) => {
            setTimeout(resolve, 2);
          }),
      );
    }
    assert.fail(
      `Expected a completed cycle with ${reads} summary reads; received ${JSON.stringify(f.count())}`,
    );
  });

layer(NodePlatformLayer)("demand coordinator", (it) => {
  it.effect(
    "does zero GitHub reads on startup, registration, cached statuses and turn-end without demand",
    () =>
      Effect.gen(function* () {
        const f = yield* setup();
        yield* f.service.registerPullRequest(f.ref, prRef);
        yield* f.coordinator.statuses([f.ref]);
        yield* f.coordinator.dirty(f.ref);
        yield* TestClock.adjust("20 minutes");
        assert.deepEqual(f.count(), { reads: 0, discoveries: 0, stacks: 0 });
        assert.equal(f.calls.open, 0);
        assert.equal((yield* f.coordinator.statuses([f.ref]))[0]?.links[0]?.snapshot, null);
      }),
  );
  it.effect(
    "shares reads across sessions/windows and does not invalidate fresh results on renewal",
    () =>
      Effect.gen(function* () {
        const f = yield* setup();
        const second = yield* f.service.create({ projectId: "project", cwd: f.home });
        yield* f.service.registerPullRequest(f.ref, prRef);
        yield* f.service.registerPullRequest(second.ref, prRef);
        const lease = yield* f.coordinator.demand({ version: 0, refs: [f.ref, second.ref] });
        yield* settle;
        yield* waitForCycle(f, 1, undefined, [f.ref, second.ref]);
        const another = yield* f.coordinator.demand({ version: 0, refs: [f.ref] });
        yield* f.coordinator.demand({
          leaseId: lease.leaseId,
          version: 1,
          refs: [f.ref, second.ref],
        });
        yield* settle;
        assert.deepEqual(f.count(), { reads: 1, discoveries: 1, stacks: 1 });
        assert.equal(
          (yield* f.coordinator.statuses([f.ref, second.ref])).every(
            (status) => status.links[0]?.snapshot?.ref.number === 42,
          ),
          true,
        );
        yield* f.coordinator.demand({ leaseId: another.leaseId, version: 1, refs: [] });
      }),
  );
  it.effect("reuses saved successful summary and topology checks after coordinator restart", () =>
    Effect.gen(function* () {
      const f = yield* setup();
      yield* f.service.registerPullRequest(f.ref, prRef);
      yield* f.coordinator.refresh(f.ref);
      const restarted = yield* makePullRequestCoordinator({
        sessions: f.service,
        github: f.github,
        bus: f.bus,
        newLeaseId: f.newLeaseId,
        projectPathFor: () => Effect.succeed(f.home),
      });
      assert.deepEqual(f.count(), { reads: 1, discoveries: 1, stacks: 1 });
      yield* restarted.demand({ version: 0, refs: [f.ref] });
      yield* settle;
      yield* waitForCycle({ ...f, coordinator: restarted }, 1, 1);
      assert.deepEqual(f.count(), { reads: 1, discoveries: 2, stacks: 1 });
    }),
  );
  it.effect(
    "shares native topology across newly expanded members without restoring exclusions",
    () =>
      Effect.gen(function* () {
        const layers = [42, 43, 44].map((number) => ({
          ref: { ...prRef, number },
          headBranch: `layer-${number}`,
          lifecycle: null,
        }));
        const f = yield* setup({
          stack: () => Effect.succeed({ id: "native", number: 1, baseBranch: "main", layers }),
        });
        yield* f.service.registerPullRequest(f.ref, prRef);
        yield* f.service.registerPullRequest(f.ref, { ...prRef, number: 43 });
        yield* f.service.excludePullRequest(f.ref, { ...prRef, number: 43 });
        yield* f.coordinator.refresh(f.ref);
        yield* f.coordinator.refresh(f.ref);
        assert.deepEqual(f.count(), { reads: 3, discoveries: 2, stacks: 2 });
        const links = yield* f.service.pullRequestsFor(f.ref);
        assert.equal(links.find((link) => link.ref.number === 43)?.excluded, true);
        assert.equal(links.find((link) => link.ref.number === 44)?.snapshot?.ref.number, 44);
      }),
  );
  it.effect("refreshes open snapshots at 60 seconds and stops after lease expiry", () =>
    Effect.gen(function* () {
      const f = yield* setup();
      yield* f.service.registerPullRequest(f.ref, prRef);
      yield* f.coordinator.demand({ version: 0, refs: [f.ref] });
      yield* settle;
      yield* waitForCycle(f, 1);
      assert.equal(f.count().reads, 1);
      yield* TestClock.adjust("58 seconds");
      assert.equal(f.count().reads, 1);
      yield* TestClock.adjust("2 seconds");
      yield* waitForCycle(f, 2);
      assert.equal(f.count().reads, 2);
      yield* TestClock.adjust("10 minutes");
      assert.equal(f.count().reads, 2);
    }),
  );
  it.effect(
    "keeps merged summaries fresh but independently expires topology and branch discovery",
    () =>
      Effect.gen(function* () {
        const f = yield* setup({
          summary: () => Effect.succeed({ ...summary, lifecycle: { type: "merged" } }),
        });
        yield* f.service.registerPullRequest(f.ref, prRef);
        const lease = yield* f.coordinator.demand({ version: 0, refs: [f.ref] });
        yield* settle;
        yield* waitForCycle(f, 1);
        for (let version = 1; version <= 11; version++) {
          yield* TestClock.adjust("30 seconds");
          yield* f.coordinator.demand({ leaseId: lease.leaseId, version, refs: [f.ref] });
        }
        yield* waitForCycle(f, 1, 2);
        assert.equal(f.count().reads, 1);
        assert.equal(f.count().stacks, 2);
        assert.equal(f.count().discoveries, 2);
        yield* f.coordinator.dirty(f.ref);
        yield* settle;
        yield* waitForCycle(f, 2);
        assert.equal(f.count().reads, 2);
      }),
  );
  it.effect(
    "rejects old versions, released capabilities, expired capabilities and unknown capabilities",
    () =>
      Effect.gen(function* () {
        const f = yield* setup();
        const lease = yield* f.coordinator.demand({ version: 1, refs: [f.ref] });
        for (const version of [0, 1])
          assert.equal(
            (yield* Effect.result(
              f.coordinator.demand({ leaseId: lease.leaseId, version, refs: [] }),
            ))._tag,
            "Failure",
          );
        yield* f.coordinator.demand({ leaseId: lease.leaseId, version: 2, refs: [] });
        assert.equal(
          (yield* Effect.result(
            f.coordinator.demand({ leaseId: lease.leaseId, version: 3, refs: [f.ref] }),
          ))._tag,
          "Failure",
        );
        const fresh = yield* f.coordinator.demand({ version: 0, refs: [f.ref] });
        yield* TestClock.adjust("91 seconds");
        assert.equal(
          (yield* Effect.result(
            f.coordinator.demand({ leaseId: fresh.leaseId, version: 1, refs: [f.ref] }),
          ))._tag,
          "Failure",
        );
        assert.equal(
          (yield* Effect.result(
            f.coordinator.demand({ leaseId: "not-a-capability", version: 1, refs: [f.ref] }),
          ))._tag,
          "Failure",
        );
      }),
  );
  it.effect("preserves a dirty event arriving during an in-flight read", () =>
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      let first = true;
      const f = yield* setup({
        summary: () =>
          Effect.gen(function* () {
            if (first) {
              first = false;
              yield* Deferred.succeed(started, undefined);
              yield* Deferred.await(release);
            }
            return summary;
          }),
      });
      yield* f.service.registerPullRequest(f.ref, prRef);
      yield* f.coordinator.demand({ version: 0, refs: [f.ref] });
      yield* Deferred.await(started);
      yield* f.coordinator.dirty(f.ref);
      yield* Deferred.succeed(release, undefined);
      yield* waitForCycle(f, 1);
      yield* settle;
      yield* waitForCycle(f, 2);
      assert.equal(f.count().reads, 2);
    }),
  );
  it.effect(
    "allows an in-flight result to save after release but starts no topology, retry or sibling read",
    () =>
      Effect.gen(function* () {
        const started = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();
        const f = yield* setup({
          summary: () =>
            Deferred.succeed(started, undefined).pipe(
              Effect.andThen(Deferred.await(release)),
              Effect.as(summary),
            ),
        });
        yield* f.service.registerPullRequest(f.ref, prRef);
        yield* f.service.registerPullRequest(f.ref, { ...prRef, number: 43 });
        const lease = yield* f.coordinator.demand({ version: 0, refs: [f.ref] });
        yield* Deferred.await(started);
        yield* f.coordinator.demand({ leaseId: lease.leaseId, version: 1, refs: [] });
        yield* Deferred.succeed(release, undefined);
        yield* waitForCycle(f, 1);
        yield* TestClock.adjust("10 minutes");
        assert.equal(f.count().reads, 1);
        assert.equal(f.count().stacks, 0);
        assert.equal((yield* f.service.pullRequestsFor(f.ref))[0]?.snapshot?.title, summary.title);
      }),
  );
  it.effect(
    "isolates failures, preserves snapshots and backs off errors even on explicit refresh",
    () =>
      Effect.gen(function* () {
        let failing = false;
        const f = yield* setup({
          summary: (_cwd, ref) =>
            ref.number === 43 || failing
              ? Effect.fail(new PullRequestHostUnavailable())
              : Effect.succeed(summary),
        });
        yield* f.service.registerPullRequest(f.ref, prRef);
        yield* f.coordinator.refresh(f.ref);
        failing = true;
        yield* f.service.registerPullRequest(f.ref, { ...prRef, number: 43 });
        const result = yield* f.coordinator.refresh(f.ref);
        assert.equal(result.state, "error");
        assert.equal(result.links[0]?.snapshot?.title, summary.title);
        const count = f.count().reads;
        yield* f.coordinator.refresh(f.ref);
        assert.equal(f.count().reads, count);
        yield* TestClock.adjust("1 minute");
        assert.equal(f.count().reads, count);
        failing = false;
        yield* f.coordinator.refresh(f.ref);
        assert.equal(f.count().reads, count + 2);
      }),
  );
  it.effect("applies authentication cooldown across PRs on the host without retry storms", () =>
    Effect.gen(function* () {
      const f = yield* setup({ summary: () => Effect.fail(new PullRequestUnauthenticated()) });
      for (let number = 1; number <= 10; number++)
        yield* f.service.registerPullRequest(f.ref, { ...prRef, number });
      yield* f.coordinator.refresh(f.ref);
      assert.equal(f.count().reads, 1);
      yield* f.coordinator.refresh(f.ref);
      assert.equal(f.count().reads, 1);
    }),
  );
  it.effect(
    "respects cancellation during a remote read and never resurrects a deleted record",
    () =>
      Effect.gen(function* () {
        const started = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();
        const f = yield* setup({
          summary: () =>
            Deferred.succeed(started, undefined).pipe(
              Effect.andThen(Deferred.await(release)),
              Effect.as(summary),
            ),
        });
        yield* f.service.registerPullRequest(f.ref, prRef);
        const refresh = yield* f.coordinator.refresh(f.ref).pipe(Effect.forkChild);
        yield* Deferred.await(started);
        yield* f.service.excludePullRequest(f.ref, prRef);
        yield* Deferred.succeed(release, undefined);
        yield* Fiber.join(refresh);
        assert.equal((yield* f.service.pullRequestsFor(f.ref))[0]?.excluded, true);
        assert.equal((yield* f.service.pullRequestsFor(f.ref))[0]?.snapshot, null);
        yield* f.service.delete(f.ref);
        assert.equal((yield* f.coordinator.refresh(f.ref)).state, "error");
        assert.equal(
          (yield* Effect.result(f.stored.read(f.ref.projectId, f.ref.sessionId)))._tag,
          "Failure",
        );
      }),
  );
  it.effect("drops queued reads on release without inventing an outage or retry backoff", () =>
    Effect.gen(function* () {
      const release = yield* Deferred.make<void>();
      const started = yield* Deferred.make<void>();
      let active = 0;
      const f = yield* setup({
        summary: (_cwd, ref) =>
          Effect.gen(function* () {
            if (++active === 4) yield* Deferred.succeed(started, undefined);
            yield* Deferred.await(release);
            return { ...summary, ref };
          }),
      });
      const refs = [f.ref];
      for (let number = 1; number < 6; number++)
        refs.push((yield* f.service.create({ projectId: "project", cwd: f.home })).ref);
      for (const [index, ref] of refs.entries()) {
        if (!ref) throw new Error("missing session");
        yield* f.service.registerPullRequest(ref, { ...prRef, number: index + 1 });
      }
      const lease = yield* f.coordinator.demand({ version: 0, refs });
      yield* Deferred.await(started);
      yield* Effect.eventually(
        f.coordinator.statuses(refs).pipe(
          Effect.filterOrFail(
            (statuses) => statuses.every((status) => status.state === "pending"),
            () => new Error("Waiting for queued work"),
          ),
        ),
      );
      yield* f.coordinator.demand({ leaseId: lease.leaseId, version: 1, refs: [] });
      yield* Deferred.succeed(release, undefined);
      yield* waitForCycle(f, 4, 0, refs);
      const statuses = yield* f.coordinator.statuses(refs);
      const queued = statuses.find((status) => status.links[0]?.snapshot === null);
      assert.ok(queued);
      const refreshed = yield* f.coordinator.refresh(queued.ref);
      assert.equal(refreshed.state, "ready");
      assert.equal(f.count().reads, 5);
    }),
  );
  it.effect("bounds concurrent reads and shares in-flight work", () =>
    Effect.gen(function* () {
      const release = yield* Deferred.make<void>();
      const started = yield* Deferred.make<void>();
      let active = 0,
        maximum = 0;
      const f = yield* setup({
        summary: (_cwd, ref) =>
          Effect.gen(function* () {
            active++;
            maximum = Math.max(maximum, active);
            if (active === 4) yield* Deferred.succeed(started, undefined);
            yield* Deferred.await(release);
            active--;
            return { ...summary, ref };
          }),
      });
      const refs = [f.ref];
      for (let index = 0; index < 7; index++)
        refs.push((yield* f.service.create({ projectId: "project", cwd: f.home })).ref);
      for (const [index, ref] of refs.entries()) {
        if (!ref) throw new Error("missing session");
        yield* f.service.registerPullRequest(ref, { ...prRef, number: index + 1 });
      }
      yield* f.coordinator.demand({ version: 0, refs });
      yield* Deferred.await(started);
      assert.equal(maximum, 4);
      yield* Deferred.succeed(release, undefined);
      yield* waitForCycle(f, 8, undefined, refs);
      assert.equal(maximum, 4);
      assert.equal(f.count().reads, 8);
    }),
  );
});
