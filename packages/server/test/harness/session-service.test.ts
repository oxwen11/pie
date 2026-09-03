import assert from "node:assert/strict";

import { layer } from "@effect/vitest";
import { isSessionScopedEvent, type SessionRef } from "@getpie/contract";
import type { UIMessage } from "ai";
import { Effect, Fiber, Layer, Logger, References, Stream } from "effect";

import { structured, type LogRecord } from "../log-record";
import { NodePlatformLayer } from "../platform";
import { type Fixture, run, UUID_RE } from "./session-service-fixture";

layer(NodePlatformLayer)("PiAgentSessionService", (it) => {
  it.effect("create passes the cwd through, generates a uuid sessionId, persists metadata", () =>
    Effect.gen(function* () {
      const result = yield* run({}, (fixture) =>
        Effect.gen(function* () {
          const created = yield* fixture.service.create({
            projectId: "proj-a",
            cwd: "/tmp/pie-app",
          });
          const stored = yield* fixture.repo.read(created.ref.projectId, created.ref.sessionId);
          return { created, stored, spy: fixture.spy };
        }),
      );

      assert.equal(result.created.ref.projectId, "proj-a");
      assert.match(result.created.ref.sessionId, UUID_RE);
      assert.deepEqual(result.created.workspace, { cwd: "/tmp/pie-app" });
      assert.deepEqual(result.spy.open, []);
      assert.equal(result.stored.agentSessionId, undefined);
      assert.equal(result.stored.projectId, "proj-a");
      assert.equal(result.stored.cwd, "/tmp/pie-app");
      assert.equal(result.stored.archived, false);
    }),
  );

  it.effect("create persists an optional title", () =>
    Effect.gen(function* () {
      const result = yield* run({}, (fixture) =>
        Effect.gen(function* () {
          const created = yield* fixture.service.create({
            projectId: "proj-a",
            cwd: "/tmp/pie-app",
            title: "Morning review",
          });
          const stored = yield* fixture.repo.read(created.ref.projectId, created.ref.sessionId);
          const listed = yield* fixture.service.list("proj-a", false);
          return { stored, listed };
        }),
      );

      assert.equal(result.stored.title, "Morning review");
      assert.equal("schedule" in result.stored, false);
      assert.equal("scheduleId" in result.stored, false);
      assert.equal("automation" in result.stored, false);
      assert.equal("automationId" in result.stored, false);
      assert.equal(result.listed[0]?.title, "Morning review");
      assert.equal("schedule" in result.listed[0], false);
      assert.equal("scheduleId" in result.listed[0], false);
      assert.equal("automation" in result.listed[0], false);
      assert.equal("automationId" in result.listed[0], false);
    }),
  );

  it.effect("appends unique pull request refs without replacing earlier ones", () =>
    Effect.gen(function* () {
      const first = {
        host: "github.com",
        owner: "getpie",
        repository: "pie",
        number: 99,
      };
      const second = { ...first, number: 109 };
      const result = yield* run({}, (fixture) =>
        Effect.gen(function* () {
          const { ref } = yield* fixture.service.create({
            projectId: "proj-a",
            cwd: "/tmp/pie-app",
          });
          yield* fixture.service.rememberPullRequestRef(ref, first);
          yield* fixture.service.rememberPullRequestRef(ref, first);
          yield* fixture.service.rememberPullRequestRef(ref, second);
          return {
            listed: yield* fixture.service.pullRequestRefsFor(ref),
            stored: yield* fixture.repo.read(ref.projectId, ref.sessionId),
          };
        }),
      );
      assert.deepEqual(result.listed, [first, second]);
      assert.deepEqual(result.stored.pullRequestRefs, [first, second]);
    }),
  );

  it.effect("the first prompt opens Pi with the model stored at create", () =>
    Effect.gen(function* () {
      const result = yield* run({}, (fixture) =>
        Effect.gen(function* () {
          const { ref } = yield* fixture.service.create({
            projectId: "proj-a",
            cwd: "/tmp/pie-app",
            model: { provider: "p", modelId: "m2" },
          });
          const before = yield* fixture.service.getModelState(ref);
          yield* fixture.service.prompt({ ref, parts: [{ type: "text", text: "hello" }] });
          yield* awaitOpen(fixture);
          return { before, open: fixture.spy.open.slice() };
        }),
      );
      assert.deepEqual(result.before, { provider: "p", modelId: "m2" });
      assert.deepEqual(result.open, [{ cwd: "/tmp/pie-app", provider: "p", modelId: "m2" }]);
    }),
  );

  it.effect("create succeeds without opening Pi even when the agent is unavailable", () =>
    Effect.gen(function* () {
      const result = yield* run({ unavailable: "not installed" }, (fixture) =>
        Effect.gen(function* () {
          const { ref } = yield* fixture.service.create({
            projectId: "proj-a",
            cwd: "/tmp/pie-app",
          });
          const listed = yield* fixture.repo.list("proj-a");
          return { ref, listed, spy: fixture.spy };
        }),
      );
      assert.equal(result.listed.length, 1);
      assert.deepEqual(result.spy.open, []);
    }),
  );

  it.effect("prepare backfills the cwd and starts nothing", () =>
    Effect.gen(function* () {
      const result = yield* run({}, (fixture) =>
        Effect.gen(function* () {
          const { ref } = yield* fixture.service.create({
            projectId: "proj-a",
            cwd: "/tmp/pie-app",
          });
          yield* fixture.service.close(ref);
          // A record from before we stored cwd — the case the backfill exists for.
          const stored = yield* fixture.repo.read(ref.projectId, ref.sessionId);
          const { cwd: _dropped, ...withoutCwd } = stored;
          yield* fixture.repo.write(withoutCwd);

          const workspace = yield* fixture.service.prepare(ref);
          const after = yield* fixture.repo.read(ref.projectId, ref.sessionId);
          return { workspace, cwd: after.cwd, resume: fixture.spy.resume, open: fixture.spy.open };
        }),
      );
      assert.deepEqual(result.workspace, { cwd: "/tmp/pie-app" });
      assert.equal(result.cwd, "/tmp/pie-app");
      // Opening a session page costs no process — the whole point of `prepare`.
      assert.deepEqual(result.resume, []);
      assert.equal(result.open.length, 0);
    }),
  );

  it.effect(
    "prepare keeps an existing worktree cwd instead of replacing it with the project path",
    () =>
      Effect.gen(function* () {
        const result = yield* run({}, (fixture) =>
          Effect.gen(function* () {
            const { ref } = yield* fixture.service.create({
              projectId: "proj-a",
              cwd: "/tmp/pie-worktree",
            });
            const stored = yield* fixture.repo.read(ref.projectId, ref.sessionId);
            yield* fixture.repo.write({ ...stored, gitBranch: "pie/test" });
            yield* fixture.service.close(ref);
            const workspace = yield* fixture.service.prepare(ref);
            const after = yield* fixture.repo.read(ref.projectId, ref.sessionId);
            return { workspace, cwd: after.cwd };
          }),
        );
        assert.deepEqual(result.workspace, { cwd: "/tmp/pie-worktree", gitBranch: "pie/test" });
        assert.equal(result.cwd, "/tmp/pie-worktree");
      }),
  );

  it.effect("getMessages reads history through the persisted worktree cwd", () =>
    Effect.gen(function* () {
      const history: UIMessage[] = [{ id: "m1", role: "user", parts: [] }];
      const result = yield* run({ coldHistory: history }, (fixture) =>
        Effect.gen(function* () {
          const { ref } = yield* fixture.service.create({
            projectId: "proj-a",
            cwd: "/tmp/pie-worktree",
          });
          const stored = yield* fixture.repo.read(ref.projectId, ref.sessionId);
          yield* fixture.repo.write({
            ...stored,
            gitBranch: "pie/test",
            agentSessionId: "native-1",
          });
          yield* fixture.service.close(ref);
          const workspace = yield* fixture.service.workspaceFor(ref);
          const messages = yield* fixture.service.getMessages(ref);
          return { workspace, messages };
        }),
      );
      assert.deepEqual(result.workspace, { cwd: "/tmp/pie-worktree", gitBranch: "pie/test" });
      assert.deepEqual(result.messages, history);
    }),
  );

  it.effect("prepare fails with SessionNotFound for an unknown session", () =>
    Effect.gen(function* () {
      const err = yield* run({}, (fixture) =>
        Effect.flip(fixture.service.prepare({ projectId: "proj-a", sessionId: "missing" })),
      );
      assert.equal(err._tag, "SessionNotFound");
    }),
  );

  it.effect("close is a no-op when Pi was never opened", () =>
    Effect.gen(function* () {
      const closeSpy = yield* run({}, (fixture) =>
        Effect.gen(function* () {
          const { ref } = yield* fixture.service.create({
            projectId: "proj-a",
            cwd: "/tmp/pie-app",
          });
          yield* fixture.service.close(ref);
          return fixture.spy.close;
        }),
      );
      assert.deepEqual(closeSpy, []);
    }),
  );

  it.effect("delete removes metadata even when Pi was never opened", () =>
    Effect.gen(function* () {
      const result = yield* run({}, (fixture) =>
        Effect.gen(function* () {
          const { ref } = yield* fixture.service.create({
            projectId: "proj-a",
            cwd: "/tmp/pie-app",
          });
          yield* fixture.service.delete(ref);
          const listed = yield* fixture.service.list("proj-a", false);
          const lockSize = yield* fixture.locks.size;
          return { listed, closeSpy: fixture.spy.close, lockSize };
        }),
      );
      assert.deepEqual(result.closeSpy, []);
      assert.equal(result.listed.length, 0);
      assert.equal(result.lockSize, 0);
    }),
  );

  it.effect("list returns one summary per session, keyed by server sessionId", () =>
    Effect.gen(function* () {
      const result = yield* run({}, (fixture) =>
        Effect.gen(function* () {
          const { ref: a } = yield* fixture.service.create({
            projectId: "proj-a",
            cwd: "/tmp/pie-app",
          });
          const { ref: b } = yield* fixture.service.create({
            projectId: "proj-a",
            cwd: "/tmp/pie-app",
          });
          const listed = yield* fixture.service.list("proj-a", false);
          return { a, b, listed };
        }),
      );
      assert.equal(result.listed.length, 2);
      assert.deepEqual(
        Array.from(result.listed.map((summary) => summary.sessionId)).sort(),
        Array.from([result.a.sessionId, result.b.sessionId]).sort(),
      );
      // We own the record, so a session we created reads as history-available.
      assert.equal(
        result.listed.every((summary) => summary.historyAvailable),
        true,
      );
      assert.equal(
        result.listed.every((summary) => !summary.archived),
        true,
      );
    }),
  );

  it.effect("archives and restores a session, publishing each changed state", () =>
    Effect.gen(function* () {
      const result = yield* run({}, (fixture) =>
        Effect.gen(function* () {
          const { ref } = yield* fixture.service.create({
            projectId: "proj-a",
            cwd: "/tmp/pie-app",
          });
          return yield* Effect.scoped(
            Effect.gen(function* () {
              const stream = yield* fixture.bus.subscribe({ kind: "global" });
              yield* fixture.service.archive(ref, true);
              const archived = yield* fixture.service.list("proj-a", true);
              const activeWhileArchived = yield* fixture.service.list("proj-a", false);
              yield* fixture.service.archive(ref, true); // idempotent: no duplicate event
              yield* fixture.service.archive(ref, false);
              const restored = yield* fixture.service.list("proj-a", false);
              const archivedAfterRestore = yield* fixture.service.list("proj-a", true);
              const items = yield* Stream.runCollect(Stream.take(stream, 2));
              return {
                archived,
                activeWhileArchived,
                restored,
                archivedAfterRestore,
                items: Array.from(items),
              };
            }),
          );
        }),
      );

      assert.equal(result.archived[0]?.archived, true);
      assert.deepEqual(result.activeWhileArchived, []);
      assert.equal(result.restored[0]?.archived, false);
      assert.deepEqual(result.archivedAfterRestore, []);
      assert.deepEqual(
        result.items.map((item) =>
          item.type === "event" && item.event.type === "session.archived"
            ? item.event.archived
            : undefined,
        ),
        [true, false],
      );
    }),
  );

  it.effect("getMessages returns empty for a session Pi has never opened", () =>
    Effect.gen(function* () {
      const messages = yield* run({}, (fixture) =>
        Effect.gen(function* () {
          const { ref } = yield* fixture.service.create({
            projectId: "proj-a",
            cwd: "/tmp/pie-app",
          });
          return yield* fixture.service.getMessages(ref);
        }),
      );
      assert.deepEqual(messages, []);
    }),
  );

  it.effect("getMessages reopens a closed session and reads through the live instance", () =>
    Effect.gen(function* () {
      const history: UIMessage[] = [{ id: "m1", role: "user", parts: [] }];
      const result = yield* run({ history }, (fixture) =>
        Effect.gen(function* () {
          const { ref } = yield* fixture.service.create({
            projectId: "proj-a",
            cwd: "/tmp/pie-app",
          });
          yield* fixture.service.prompt({ ref, parts: [{ type: "text", text: "hello" }] });
          yield* awaitOpen(fixture);
          yield* fixture.service.close(ref);
          const messages = yield* fixture.service.getMessages(ref);
          return { messages, resume: fixture.spy.resume };
        }),
      );
      assert.deepEqual(result.resume, [{ sessionId: "native-1", cwd: "/tmp/pie-app" }]);
      assert.deepEqual(result.messages, history);
    }),
  );

  const fourTurnHistory: UIMessage[] = [
    { id: "u1", role: "user", parts: [] },
    { id: "a1", role: "assistant", parts: [] },
    { id: "u2", role: "user", parts: [] },
    { id: "a2", role: "assistant", parts: [] },
  ];

  // The drain into the projection is async; poll until it has seen the turn.
  const awaitOpen = (fixture: Fixture): Effect.Effect<void> =>
    Effect.gen(function* () {
      for (let attempt = 0; attempt < 1000; attempt += 1) {
        if (fixture.spy.open.length > 0) return;
        yield* Effect.yieldNow;
      }
      return yield* Effect.die(new Error("timed out waiting for Pi open"));
    });

  const waitForTurn = (
    fixture: Fixture,
    ref: SessionRef,
    done: (turn: { complete: boolean } | null) => boolean,
  ): Effect.Effect<void> =>
    Effect.gen(function* () {
      for (let attempt = 0; attempt < 1000; attempt += 1) {
        const turn = yield* fixture.service
          .getSnapshot(ref)
          .pipe(Effect.map((snapshot) => snapshot.activeTurn));
        if (done(turn)) return;
        yield* Effect.yieldNow;
      }
      return yield* Effect.die(new Error("timed out waiting for turn"));
    });

  it.effect("archives a running session and closes its live instance", () =>
    Effect.gen(function* () {
      const result = yield* run({ turn: "open" }, (fixture) =>
        Effect.gen(function* () {
          const { ref } = yield* fixture.service.create({
            projectId: "proj-a",
            cwd: "/tmp/pie-app",
          });
          yield* fixture.service.prompt({ ref, parts: [{ type: "text", text: "go" }] });
          yield* Effect.yieldNow;
          yield* waitForTurn(fixture, ref, (turn) => turn !== null && !turn.complete);
          yield* fixture.service.archive(ref, true);
          const active = yield* fixture.service.list("proj-a", false);
          const archived = yield* fixture.service.list("proj-a", true);
          return { active, archived, closed: fixture.spy.close.slice() };
        }),
      );

      assert.deepEqual(result.active, []);
      assert.equal(result.archived.length, 1);
      assert.equal(result.archived[0]?.status, undefined);
      assert.deepEqual(result.closed, ["native-1"]);
    }),
  );

  it.effect("getMessages trims the last user segment while a turn is in flight", () =>
    Effect.gen(function* () {
      const messages = yield* run({ history: fourTurnHistory, turn: "open" }, (fixture) =>
        Effect.gen(function* () {
          const { ref } = yield* fixture.service.create({
            projectId: "proj-a",
            cwd: "/tmp/pie-app",
          });
          yield* fixture.service.prompt({ ref, parts: [{ type: "text", text: "go" }] });
          yield* Effect.yieldNow;
          yield* waitForTurn(fixture, ref, (turn) => turn !== null && !turn.complete);
          return yield* fixture.service.getMessages(ref);
        }),
      );
      assert.deepEqual(
        messages.map((message) => message.id),
        ["u1", "a1"],
      );
    }),
  );

  it.effect("getMessages does not trim for a finished turn's retained buffer", () =>
    Effect.gen(function* () {
      const messages = yield* run({ history: fourTurnHistory, turn: "finished" }, (fixture) =>
        Effect.gen(function* () {
          const { ref } = yield* fixture.service.create({
            projectId: "proj-a",
            cwd: "/tmp/pie-app",
          });
          yield* fixture.service.prompt({ ref, parts: [{ type: "text", text: "go" }] });
          yield* Effect.yieldNow;
          yield* waitForTurn(fixture, ref, (turn) => turn?.complete === true);
          return yield* fixture.service.getMessages(ref);
        }),
      );
      assert.deepEqual(
        messages.map((message) => message.id),
        ["u1", "a1", "u2", "a2"],
      );
    }),
  );

  it.effect("getMessages reads cold through the adapter without starting anything", () =>
    Effect.gen(function* () {
      const history: UIMessage[] = [{ id: "m1", role: "user", parts: [] }];
      const result = yield* run({ coldHistory: history }, (fixture) =>
        Effect.gen(function* () {
          const { ref } = yield* fixture.service.create({
            projectId: "proj-a",
            cwd: "/tmp/pie-app",
          });
          const stored = yield* fixture.repo.read(ref.projectId, ref.sessionId);
          yield* fixture.repo.write({ ...stored, agentSessionId: "native-already" });
          yield* fixture.service.close(ref);
          const messages = yield* fixture.service.getMessages(ref);
          return { messages, resume: fixture.spy.resume };
        }),
      );
      assert.deepEqual(result.messages, history);
      // A harness that can read its own transcript is never asked for a process.
      assert.deepEqual(result.resume, []);
    }),
  );

  it.effect("interrupt succeeds with nothing running instead of starting an agent", () =>
    Effect.gen(function* () {
      const result = yield* run({}, (fixture) =>
        Effect.gen(function* () {
          const { ref } = yield* fixture.service.create({
            projectId: "proj-a",
            cwd: "/tmp/pie-app",
          });
          yield* fixture.service.close(ref);
          yield* fixture.service.interrupt(ref);
          return fixture.spy.resume;
        }),
      );
      // The turn it would have stopped died with the process; resuming one in
      // order to interrupt it would be absurd.
      assert.deepEqual(result, []);
    }),
  );

  it.effect("replaceQueue with empty arrays succeeds with nothing running", () =>
    Effect.gen(function* () {
      const result = yield* run({}, (fixture) =>
        Effect.gen(function* () {
          const { ref } = yield* fixture.service.create({
            projectId: "proj-a",
            cwd: "/tmp/pie-app",
          });
          yield* fixture.service.close(ref);
          yield* fixture.service.replaceQueue({ ref, steering: [], followUp: [] });
          return fixture.spy.resume;
        }),
      );
      assert.deepEqual(result, []);
    }),
  );

  it.effect("replaceQueue with remaining items fails closed instead of starting an agent", () =>
    Effect.gen(function* () {
      const result = yield* run({}, (fixture) =>
        Effect.gen(function* () {
          const { ref } = yield* fixture.service.create({
            projectId: "proj-a",
            cwd: "/tmp/pie-app",
          });
          yield* fixture.service.close(ref);
          const err = yield* Effect.flip(
            fixture.service.replaceQueue({ ref, steering: ["steer"], followUp: [] }),
          );
          return { err, resume: fixture.spy.resume };
        }),
      );
      assert.equal(result.err._tag, "SessionClosed");
      assert.deepEqual(result.resume, []);
    }),
  );

  it.effect("respondToAgentRequest reports the request as gone with nothing running", () =>
    Effect.gen(function* () {
      const result = yield* run({}, (fixture) =>
        Effect.gen(function* () {
          const { ref } = yield* fixture.service.create({
            projectId: "proj-a",
            cwd: "/tmp/pie-app",
          });
          yield* fixture.service.close(ref);
          const err = yield* Effect.flip(
            fixture.service.respondToAgentRequest(ref, "req-1", {
              type: "tool",
              behavior: "allow",
            }),
          );
          return { err, resume: fixture.spy.resume };
        }),
      );
      assert.equal(result.err._tag, "AgentRequestUnavailable");
      assert.deepEqual(result.resume, []);
    }),
  );

  // The bug this whole shape exists for: a browser left open across a server
  // restart used to hit SESSION_NOT_ACTIVE on every snapshot and retry forever,
  // because nothing on the observation path could make the error go away.
  it.effect("a restarted server answers for a session it has never touched", () =>
    Effect.gen(function* () {
      const result = yield* run({}, (fixture) =>
        Effect.gen(function* () {
          const { ref } = yield* fixture.service.create({
            projectId: "proj-a",
            cwd: "/tmp/pie-app",
          });
          const restarted = yield* fixture.restart;

          yield* restarted.service.prepare(ref);
          const status = yield* restarted.service.getStatus(ref);
          const snapshot = yield* restarted.service.getSnapshot(ref);
          const listed = yield* restarted.service.list("proj-a", false);
          const messages = yield* restarted.service.getMessages(ref);
          return { ref, status, snapshot, listed, messages, spy: fixture.spy };
        }),
      );

      // Everything a reattaching client asks for is answerable …
      assert.deepEqual(result.status, { phase: "idle" });
      assert.equal(result.snapshot.cursor, 0);
      assert.equal(result.snapshot.activeTurn, null);
      // Never opened on the previous process either — no agentSessionId, no transcript.
      assert.deepEqual(result.messages, []);
      // … a session nothing has touched carries no status at all, so the sidebar
      // does not light up every row as active …
      assert.equal(result.listed.length, 1);
      assert.equal(result.listed[0]?.status, undefined);
      // … and none of it started an agent until the first prompt.
      assert.equal(result.spy.open.length, 0);
      assert.deepEqual(result.spy.resume, []);
    }),
  );

  // `turn: "finished"` keeps the fake's event stream open, which is what a real
  // runtime does: a stream that ends means the agent is done and the session
  // lets it go, so an empty one would be released between the two prompts.
  it.effect("the first prompt after a restart starts exactly one agent", () =>
    Effect.gen(function* () {
      const result = yield* run({ turn: "finished" }, (fixture) =>
        Effect.gen(function* () {
          const { ref } = yield* fixture.service.create({
            projectId: "proj-a",
            cwd: "/tmp/pie-app",
          });
          const restarted = yield* fixture.restart;
          yield* restarted.service.prepare(ref);

          yield* restarted.service.prompt({ ref, parts: [{ type: "text", text: "hello" }] });
          yield* Effect.yieldNow;
          yield* restarted.service.prompt({ ref, parts: [{ type: "text", text: "again" }] });
          yield* Effect.yieldNow;
          return fixture.spy;
        }),
      );
      // First prompt opens Pi; second reuses the live runtime.
      assert.deepEqual(result.open, [{ cwd: "/tmp/pie-app" }]);
      assert.deepEqual(result.resume, []);
    }),
  );

  it.effect("titles a session from its first prompt, collapsing whitespace", () =>
    Effect.gen(function* () {
      const listed = yield* run({}, (fixture) =>
        Effect.gen(function* () {
          const { ref } = yield* fixture.service.create({
            projectId: "proj-a",
            cwd: "/tmp/pie-app",
          });
          yield* fixture.service.prompt({
            ref,
            parts: [{ type: "text", text: "  Fix the  login  bug " }],
          });
          yield* Effect.yieldNow;
          return yield* fixture.service.list("proj-a", false);
        }),
      );
      assert.equal(listed.length, 1);
      assert.equal(listed[0]?.title, "Fix the login bug");
    }),
  );

  it.effect("publishes session.updated with the collapsed title on the first prompt", () =>
    Effect.gen(function* () {
      const result = yield* run({}, (fixture) =>
        Effect.gen(function* () {
          const { ref } = yield* fixture.service.create({
            projectId: "proj-a",
            cwd: "/tmp/pie-app",
          });
          // Subscribe after create so only the prompt's event is in flight; the
          // queue buffers it until take(1) pulls it — no forked drain, no race.
          return yield* Effect.scoped(
            Effect.gen(function* () {
              const stream = yield* fixture.bus.subscribe({ kind: "global" });
              yield* fixture.service.prompt({
                ref,
                parts: [{ type: "text", text: "  Fix the  login  bug " }],
              });
              const items = yield* Stream.runCollect(Stream.take(stream, 1));
              return Array.from(items);
            }),
          );
        }),
      );
      assert.equal(result.length, 1);
      const item = result[0];
      assert.equal(item?.type, "event");
      const event = item?.type === "event" ? item.event : undefined;
      assert.equal(event && !isSessionScopedEvent(event), true);
      assert.equal(event?.type, "session.updated");
      assert.equal(
        event?.type === "session.updated" ? event.title : undefined,
        "Fix the login bug",
      );
    }),
  );

  // A session whose native stream stays open (turn: "open" concats
  // Stream.never) keeps its runtime alive — emit needs one; a drained-out
  // stream drops the runtime and the broadcast is silently skipped.
  const takePromptSubmitted = (
    fixture: Fixture,
    ref: SessionRef,
    promptInput: { readonly messageId?: string },
  ) =>
    Effect.scoped(
      Effect.gen(function* () {
        const stream = yield* fixture.bus.subscribe({ kind: "session", ref });
        yield* fixture.service.prompt({
          ref,
          parts: [{ type: "text", text: "hello there" }],
          ...promptInput,
        });
        const items = yield* Stream.runCollect(
          Stream.take(
            Stream.filter(
              stream,
              (item) => item.type === "event" && item.event.type === "session.prompt.submitted",
            ),
            1,
          ),
        );
        const item = Array.from(items)[0];
        return item?.type === "event" ? item.event : undefined;
      }),
    );

  it.effect("broadcasts session.prompt.submitted echoing the client messageId", () =>
    Effect.gen(function* () {
      const event = yield* run({ turn: "open" }, (fixture) =>
        Effect.gen(function* () {
          const { ref } = yield* fixture.service.create({
            projectId: "proj-a",
            cwd: "/tmp/pie-app",
          });
          return yield* takePromptSubmitted(fixture, ref, { messageId: "client-msg-1" });
        }),
      );
      assert.equal(event?.type, "session.prompt.submitted");
      assert.equal(event && "messageId" in event ? event.messageId : undefined, "client-msg-1");
      assert.deepEqual(event && "parts" in event ? event.parts : undefined, [
        { type: "text", text: "hello there" },
      ]);
      // Shares the session's contiguous seq counter with harness events.
      assert.ok((event && isSessionScopedEvent(event) ? event.seq : 0) > 0);
    }),
  );

  it.effect("returns the runtime's prompt receipt", () =>
    Effect.gen(function* () {
      const receipt = yield* run({ turn: "open" }, (fixture) =>
        Effect.gen(function* () {
          const { ref } = yield* fixture.service.create({
            projectId: "proj-a",
            cwd: "/tmp/pie-app",
          });
          return yield* fixture.service.prompt({
            ref,
            parts: [{ type: "text", text: "hello there" }],
            messageId: "client-msg-1",
          });
        }),
      );
      assert.deepEqual(receipt, { turnId: "turn-1", started: true });
    }),
  );

  it.effect("retains the accepted prompt in the runtime snapshot for mid-turn joiners", () =>
    Effect.gen(function* () {
      const snapshot = yield* run({ turn: "open" }, (fixture) =>
        Effect.gen(function* () {
          const { ref } = yield* fixture.service.create({
            projectId: "proj-a",
            cwd: "/tmp/pie-app",
          });
          yield* takePromptSubmitted(fixture, ref, { messageId: "client-msg-1" });
          return yield* fixture.service.getSnapshot(ref);
        }),
      );
      // `session.prompt.submitted` is never re-sent, so the snapshot is the only
      // recovery for a client that attaches after it fired.
      assert.equal(snapshot.activePrompt?.messageId, "client-msg-1");
      assert.deepEqual(snapshot.activePrompt?.parts, [{ type: "text", text: "hello there" }]);
      assert.ok((snapshot.activePrompt?.seq ?? 0) > 0);
    }),
  );

  it.effect(
    "compensates a harness-rejected prompt: rejected event follows, no retained phantom",
    () =>
      Effect.gen(function* () {
        const result = yield* run({ turn: "open", promptFails: true }, (fixture) =>
          Effect.gen(function* () {
            const { ref } = yield* fixture.service.create({
              projectId: "proj-a",
              cwd: "/tmp/pie-app",
            });
            return yield* Effect.scoped(
              Effect.gen(function* () {
                const stream = yield* fixture.bus.subscribe({ kind: "session", ref });
                const prompt = yield* Effect.exit(
                  fixture.service.prompt({
                    ref,
                    parts: [{ type: "text", text: "loser prompt" }],
                    messageId: "loser-msg",
                  }),
                );
                yield* Effect.yieldNow;
                const items = yield* Stream.runCollect(
                  Stream.take(
                    Stream.filter(
                      stream,
                      (item) =>
                        item.type === "event" &&
                        (item.event.type === "session.prompt.submitted" ||
                          item.event.type === "session.prompt.rejected"),
                    ),
                    2,
                  ),
                );
                const snapshot = yield* fixture.service.getSnapshot(ref);
                return {
                  prompt,
                  broadcast: Array.from(items).map((item) =>
                    item.type === "event" ? item.event.type : item.type,
                  ),
                  activePrompt: snapshot.activePrompt,
                };
              }),
            );
          }),
        );
        assert.equal(result.prompt._tag, "Failure");
        assert.deepEqual(result.broadcast, ["session.prompt.submitted", "session.prompt.rejected"]);
        assert.equal(result.activePrompt, null);
      }),
  );

  it.effect("mints a messageId when the prompt carries none", () =>
    Effect.gen(function* () {
      const event = yield* run({ turn: "open" }, (fixture) =>
        Effect.gen(function* () {
          const { ref } = yield* fixture.service.create({
            projectId: "proj-a",
            cwd: "/tmp/pie-app",
          });
          return yield* takePromptSubmitted(fixture, ref, {});
        }),
      );
      assert.equal(event?.type, "session.prompt.submitted");
      const mintedId = event && "messageId" in event ? event.messageId : "";
      assert.match(mintedId, /^[0-9a-f-]{36}$/);
    }),
  );

  it.effect("skips session.prompt.submitted when a follow-up does not start a turn", () =>
    Effect.gen(function* () {
      const result = yield* run({ turn: "open", promptStarted: false }, (fixture) =>
        Effect.gen(function* () {
          const { ref } = yield* fixture.service.create({
            projectId: "proj-a",
            cwd: "/tmp/pie-app",
          });
          const receipt = yield* fixture.service.prompt({
            ref,
            parts: [{ type: "text", text: "later" }],
            delivery: "followUp",
            messageId: "queued-1",
          });
          const snapshot = yield* fixture.service.getSnapshot(ref);
          return {
            receipt,
            activePrompt: snapshot.activePrompt,
            prompts: fixture.spy.prompts,
          };
        }),
      );
      assert.deepEqual(result.receipt, { turnId: "turn-1", started: false });
      assert.equal(result.activePrompt, null);
      assert.deepEqual(result.prompts, [
        { parts: [{ type: "text", text: "later" }], delivery: "followUp" },
      ]);
    }),
  );

  it.effect("fails the RPC when a queued follow-up's deliverPrompt fails", () =>
    Effect.gen(function* () {
      const result = yield* run({ turn: "open", promptFails: true }, (fixture) =>
        Effect.gen(function* () {
          const { ref } = yield* fixture.service.create({
            projectId: "proj-a",
            cwd: "/tmp/pie-app",
          });
          const error = yield* fixture.service
            .prompt({
              ref,
              parts: [{ type: "text", text: "later" }],
              delivery: "followUp",
              messageId: "queued-fail",
            })
            .pipe(Effect.flip);
          const snapshot = yield* fixture.service.getSnapshot(ref);
          return { error, activePrompt: snapshot.activePrompt, prompts: fixture.spy.prompts };
        }),
      );
      assert.equal(result.error._tag, "TurnAlreadyRunning");
      assert.equal(result.activePrompt, null);
      assert.deepEqual(result.prompts, [
        { parts: [{ type: "text", text: "later" }], delivery: "followUp" },
      ]);
    }),
  );

  it.effect("emits session.prompt.submitted when a follow-up races to a new turn", () =>
    Effect.gen(function* () {
      const event = yield* run({ turn: "open", promptStarted: true }, (fixture) =>
        Effect.gen(function* () {
          const { ref } = yield* fixture.service.create({
            projectId: "proj-a",
            cwd: "/tmp/pie-app",
          });
          return yield* Effect.scoped(
            Effect.gen(function* () {
              const stream = yield* fixture.bus.subscribe({ kind: "session", ref });
              yield* fixture.service.prompt({
                ref,
                parts: [{ type: "text", text: "later" }],
                delivery: "followUp",
                messageId: "raced-1",
              });
              const items = yield* Stream.runCollect(
                Stream.take(
                  Stream.filter(
                    stream,
                    (item) =>
                      item.type === "event" && item.event.type === "session.prompt.submitted",
                  ),
                  1,
                ),
              );
              const item = Array.from(items)[0];
              return item?.type === "event" ? item.event : undefined;
            }),
          );
        }),
      );
      assert.equal(event?.type, "session.prompt.submitted");
      assert.equal(event && "messageId" in event ? event.messageId : undefined, "raced-1");
      assert.deepEqual(event && "parts" in event ? event.parts : undefined, [
        { type: "text", text: "later" },
      ]);
    }),
  );

  it.effect("keeps the first prompt's title; later prompts don't rename", () =>
    Effect.gen(function* () {
      const listed = yield* run({}, (fixture) =>
        Effect.gen(function* () {
          const { ref } = yield* fixture.service.create({
            projectId: "proj-a",
            cwd: "/tmp/pie-app",
          });
          yield* fixture.service.prompt({ ref, parts: [{ type: "text", text: "first" }] });
          yield* Effect.yieldNow;
          yield* fixture.service.prompt({ ref, parts: [{ type: "text", text: "second" }] });
          yield* Effect.yieldNow;
          return yield* fixture.service.list("proj-a", false);
        }),
      );
      assert.equal(listed[0]?.title, "first");
    }),
  );

  it.effect("lists a session with no title until its first prompt", () =>
    Effect.gen(function* () {
      const listed = yield* run({}, (fixture) =>
        Effect.gen(function* () {
          yield* fixture.service.create({ projectId: "proj-a", cwd: "/tmp/pie-app" });
          return yield* fixture.service.list("proj-a", false);
        }),
      );
      assert.equal(listed.length, 1);
      assert.equal(listed[0]?.title, undefined);
    }),
  );

  // The lifecycle log is what a periodic read of `$PIE_HOME/logs` is for:
  // read on its own it says what was worked on, when, and where. It has to hold
  // together across the whole span of a session, so it is asserted as a
  // sequence rather than one line at a time.
  it.effect("logs each lifecycle boundary once, in order, at info", () =>
    Effect.gen(function* () {
      const records: Array<LogRecord> = [];
      yield* run({}, (fixture) =>
        Effect.gen(function* () {
          const { ref } = yield* fixture.service.create({
            projectId: "proj-a",
            cwd: "/tmp/pie-app",
          });
          yield* fixture.service.archive(ref, true);
          yield* fixture.service.delete(ref);
        }).pipe(
          Effect.provide(
            Logger.layer([
              Logger.map(structured, (record) => {
                records.push(record);
              }),
            ]),
          ),
        ),
      );

      // Only lifecycle events are logs. The native `pi.create` span correlates
      // logs inside it but does not synthesize its own completion record.
      assert.deepEqual(
        records.map((record) => record.annotations.event),
        ["session.created", "session.archived", "session.deleted"],
      );
      assert.equal(
        records.every((record) => record.level === "INFO"),
        true,
      );

      const created = records[0];
      const sessionId = created?.annotations.sessionId;
      assert.equal(created?.annotations.cwd, "/tmp/pie-app");
      assert.equal(created?.annotations.agentSessionId, undefined);
      assert.equal(created?.annotations.projectId, "proj-a");
      // Every line carries the id, so one session's whole life greps out of a
      // file holding many.
      assert.equal(typeof sessionId, "string");
      assert.equal(
        records.every((r) => r.annotations.sessionId === sessionId),
        true,
      );
    }),
  );

  // The identity is bound once at the service boundary, not repeated at each
  // log site — so a layer that has never heard of a `SessionRef` (an adapter
  // sees `cwd` and nothing else) still writes lines that grep out with the
  // session's own. This is the test that keeps that wrap from being "tidied"
  // back into per-site annotations.
  it.effect("puts the session's identity on what the layers below it log", () =>
    Effect.gen(function* () {
      const records: Array<LogRecord> = [];
      yield* run({}, (fixture) =>
        Effect.gen(function* () {
          const { ref } = yield* fixture.service.create({
            projectId: "proj-a",
            cwd: "/tmp/pie-app",
          });
          yield* fixture.service.prompt({ ref, parts: [{ type: "text", text: "hello" }] });
          // prompt forks Pi open into the service FiberSet; keep yielding until
          // the adapter log lands so the identity wrap is still on the fiber.
          yield* Effect.gen(function* () {
            for (let attempt = 0; attempt < 200; attempt += 1) {
              if (records.some((record) => record.message === "pi creating")) return;
              yield* Effect.yieldNow;
            }
            return yield* Effect.die(new Error("timed out waiting for pi creating"));
          });
        }).pipe(
          Effect.provide(
            Layer.merge(
              Logger.layer([
                Logger.map(structured, (record) => {
                  records.push(record);
                }),
              ]),
              Layer.succeed(References.MinimumLogLevel, "Debug"),
            ),
          ),
        ),
      );

      const adapterLine = records.find((record) => record.message === "pi creating");
      assert.ok(adapterLine);
      assert.equal(adapterLine.annotations.projectId, "proj-a");
      assert.match(String(adapterLine.annotations.sessionId), UUID_RE);
    }),
  );

  // The rename used to be broadcast-only, so every client showed the new title
  // until the next list load read the old one back off disk.
  it.effect("rename persists the title across a restart", () =>
    Effect.gen(function* () {
      const result = yield* run({}, (fixture) =>
        Effect.gen(function* () {
          const { ref } = yield* fixture.service.create({
            projectId: "proj-a",
            cwd: "/tmp/pie-app",
          });
          yield* fixture.service.rename(ref, "Login bug");
          const listed = yield* fixture.service.list("proj-a", false);
          const restarted = yield* fixture.restart;
          return { listed, afterRestart: yield* restarted.service.list("proj-a", false) };
        }),
      );
      assert.equal(result.listed[0]?.title, "Login bug");
      assert.equal(result.afterRestart[0]?.title, "Login bug");
    }),
  );

  it.effect("publishes session.closed on the global firehose when the runtime is torn down", () =>
    Effect.gen(function* () {
      const result = yield* run({}, (fixture) =>
        Effect.gen(function* () {
          const { ref } = yield* fixture.service.create({
            projectId: "proj-a",
            cwd: "/tmp/pie-app",
          });
          return yield* Effect.scoped(
            Effect.gen(function* () {
              const stream = yield* fixture.bus.subscribe({ kind: "global" });
              yield* fixture.service.close(ref);
              const items = yield* Stream.runCollect(Stream.take(stream, 1));
              return Array.from(items);
            }),
          );
        }),
      );
      assert.equal(result.length, 1);
      const closed = result[0];
      assert.equal(closed?.type, "event");
      assert.equal(closed?.type === "event" ? closed.event.type : undefined, "session.closed");
      const closedRef =
        closed?.type === "event" && "ref" in closed.event ? closed.event.ref : undefined;
      assert.equal(closedRef?.projectId, "proj-a");
      const closedSessionId = closedRef?.sessionId ?? "";
      assert.match(closedSessionId, UUID_RE);
    }),
  );

  it.effect("publishes session.renamed per change, and nothing for a no-op rename", () =>
    Effect.gen(function* () {
      const result = yield* run({}, (fixture) =>
        Effect.gen(function* () {
          const { ref } = yield* fixture.service.create({
            projectId: "proj-a",
            cwd: "/tmp/pie-app",
          });
          return yield* Effect.scoped(
            Effect.gen(function* () {
              const stream = yield* fixture.bus.subscribe({ kind: "global" });
              yield* fixture.service.rename(ref, "First title");
              yield* fixture.service.rename(ref, "First title"); // no-op: no event
              yield* fixture.service.rename(ref, "Second title");
              const items = yield* Stream.runCollect(Stream.take(stream, 2));
              return Array.from(items);
            }),
          );
        }),
      );
      assert.deepEqual(
        result.map((item) =>
          item.type === "event" && item.event.type === "session.renamed"
            ? item.event.title
            : item.type,
        ),
        ["First title", "Second title"],
      );
    }),
  );

  // The title is the user's once they have chosen one: the first-prompt stamp
  // only fills a record that has none.
  it.effect("keeps a hand-chosen title through the first prompt", () =>
    Effect.gen(function* () {
      const listed = yield* run({}, (fixture) =>
        Effect.gen(function* () {
          const { ref } = yield* fixture.service.create({
            projectId: "proj-a",
            cwd: "/tmp/pie-app",
          });
          yield* fixture.service.rename(ref, "Login bug");
          yield* fixture.service.prompt({ ref, parts: [{ type: "text", text: "first" }] });
          yield* Effect.yieldNow;
          return yield* fixture.service.list("proj-a", false);
        }),
      );
      assert.equal(listed[0]?.title, "Login bug");
    }),
  );

  it.effect("preserves rename and archive changes made concurrently", () =>
    Effect.gen(function* () {
      const stored = yield* run({}, (fixture) =>
        Effect.gen(function* () {
          const { ref } = yield* fixture.service.create({
            projectId: "proj-a",
            cwd: "/tmp/pie-app",
          });
          yield* Effect.all(
            [fixture.service.rename(ref, "Login bug"), fixture.service.archive(ref, true)],
            { concurrency: "unbounded" },
          );
          return yield* fixture.repo.read(ref.projectId, ref.sessionId);
        }),
      );
      assert.equal(stored.title, "Login bug");
      assert.equal(stored.archived, true);
    }),
  );

  it.effect("keeps the manual title when rename races the first prompt stamp", () =>
    Effect.gen(function* () {
      const listed = yield* run({}, (fixture) =>
        Effect.gen(function* () {
          const { ref } = yield* fixture.service.create({
            projectId: "proj-a",
            cwd: "/tmp/pie-app",
          });
          yield* fixture.service.rename(ref, "Login bug");
          yield* fixture.service.prompt({
            ref,
            parts: [{ type: "text", text: "automatic title" }],
          });
          yield* Effect.yieldNow;
          return yield* fixture.service.list("proj-a", false);
        }),
      );
      assert.equal(listed[0]?.title, "Login bug");
    }),
  );

  it.effect("does not let one slow session close stall another session's rename", () =>
    Effect.gen(function* () {
      let releaseClose!: () => void;
      let markCloseStarted!: () => void;
      const closeStarted = new Promise<void>((resolve) => {
        markCloseStarted = resolve;
      });
      const closeReleased = new Promise<void>((resolve) => {
        releaseClose = resolve;
      });

      const stored = yield* run(
        {
          close: async (sessionId) => {
            if (sessionId !== "native-1") return;
            markCloseStarted();
            await closeReleased;
          },
        },
        (fixture) =>
          Effect.gen(function* () {
            const { ref: slow } = yield* fixture.service.create({
              projectId: "proj-a",
              cwd: "/tmp/pie-app",
            });
            yield* fixture.service.prompt({ ref: slow, parts: [{ type: "text", text: "warm" }] });
            yield* Effect.yieldNow;
            const { ref: other } = yield* fixture.service.create({
              projectId: "proj-a",
              cwd: "/tmp/pie-app",
            });
            const archiving = yield* Effect.forkChild(fixture.service.archive(slow, true));
            yield* Effect.promise(() => closeStarted);
            yield* fixture.service.rename(other, "Still responsive");
            releaseClose();
            yield* Fiber.join(archiving);
            return yield* fixture.repo.read(other.projectId, other.sessionId);
          }),
      );

      assert.equal(stored.title, "Still responsive");
    }),
  );

  it.effect("setModel on an unopened session writes metadata without opening Pi", () =>
    Effect.gen(function* () {
      const result = yield* run({}, (fixture) =>
        Effect.gen(function* () {
          const { ref } = yield* fixture.service.create({
            projectId: "proj-a",
            cwd: "/tmp/pie-app",
            model: { provider: "anthropic", modelId: "claude-opus-4-6" },
          });
          const state = yield* fixture.service.setModel(ref, {
            provider: "anthropic",
            modelId: "claude-sonnet-4-5",
          });
          const stored = yield* fixture.repo.read(ref.projectId, ref.sessionId);
          return { state, stored, open: fixture.spy.open };
        }),
      );

      assert.deepEqual(result.open, []);
      assert.deepEqual(result.state, { provider: "anthropic", modelId: "claude-sonnet-4-5" });
      assert.equal(result.stored.provider, "anthropic");
      assert.equal(result.stored.modelId, "claude-sonnet-4-5");
    }),
  );
});
