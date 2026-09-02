import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { isSessionScopedEvent, type SessionRef } from "@getpie/contract";
import type { UIMessage } from "ai";
import { Effect, Fiber, FileSystem, Layer, Logger, References, type Scope, Stream } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { structured, type LogRecord } from "../log-record";
import {
  type Fixture,
  run as runFixture,
  type SessionServiceRunOpts,
  UUID_RE,
} from "./session-service-fixture";

describe("PiAgentSessionService", () => {
  let home: string;
  beforeEach(async () => {
    home = await fs.mkdtemp(path.join(os.tmpdir(), "pie-svc-"));
  });
  afterEach(async () => {
    await fs.rm(home, { recursive: true, force: true });
  });

  const run = <A, E>(
    opts: SessionServiceRunOpts,
    program: (fixture: Fixture) => Effect.Effect<A, E, Scope.Scope | FileSystem.FileSystem>,
  ) => runFixture(home, opts, program);

  it("create passes the cwd through, generates a uuid sessionId, persists metadata", async () => {
    const result = await run({}, (fixture) =>
      Effect.gen(function* () {
        const created = yield* fixture.service.create({
          projectId: "proj-a",
          cwd: "/tmp/pie-app",
        });
        const stored = yield* fixture.repo.read(created.ref.projectId, created.ref.sessionId);
        return { created, stored, spy: fixture.spy };
      }),
    );

    expect(result.created.ref.projectId).toBe("proj-a");
    expect(result.created.ref.sessionId).toMatch(UUID_RE);
    expect(result.created.workspace).toEqual({ cwd: "/tmp/pie-app" });
    expect(result.spy.open).toEqual([]);
    expect(result.stored.agentSessionId).toBeUndefined();
    expect(result.stored.projectId).toBe("proj-a");
    expect(result.stored.cwd).toBe("/tmp/pie-app");
    expect(result.stored.archived).toBe(false);
  });

  it("appends unique pull request refs without replacing earlier ones", async () => {
    const first = {
      host: "github.com",
      owner: "getpie",
      repository: "pie",
      number: 99,
    };
    const second = { ...first, number: 109 };
    const result = await run({}, (fixture) =>
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
    expect(result.listed).toEqual([first, second]);
    expect(result.stored.pullRequestRefs).toEqual([first, second]);
  });

  it("the first prompt opens Pi with the model stored at create", async () => {
    const result = await run({}, (fixture) =>
      Effect.gen(function* () {
        const { ref } = yield* fixture.service.create({
          projectId: "proj-a",
          cwd: "/tmp/pie-app",
          model: { provider: "p", modelId: "m2" },
        });
        const before = yield* fixture.service.getModelState(ref);
        yield* fixture.service.prompt({ ref, parts: [{ type: "text", text: "hello" }] });
        yield* Effect.sleep("50 millis");
        return { before, open: fixture.spy.open };
      }),
    );
    expect(result.before).toEqual({ provider: "p", modelId: "m2" });
    expect(result.open).toEqual([{ cwd: "/tmp/pie-app", provider: "p", modelId: "m2" }]);
  });

  it("create succeeds without opening Pi even when the agent is unavailable", async () => {
    const result = await run({ unavailable: "not installed" }, (fixture) =>
      Effect.gen(function* () {
        const { ref } = yield* fixture.service.create({ projectId: "proj-a", cwd: "/tmp/pie-app" });
        const listed = yield* fixture.repo.list("proj-a");
        return { ref, listed, spy: fixture.spy };
      }),
    );
    expect(result.listed).toHaveLength(1);
    expect(result.spy.open).toEqual([]);
  });

  it("prepare backfills the cwd and starts nothing", async () => {
    const result = await run({}, (fixture) =>
      Effect.gen(function* () {
        const { ref } = yield* fixture.service.create({ projectId: "proj-a", cwd: "/tmp/pie-app" });
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
    expect(result.workspace).toEqual({ cwd: "/tmp/pie-app" });
    expect(result.cwd).toBe("/tmp/pie-app");
    // Opening a session page costs no process — the whole point of `prepare`.
    expect(result.resume).toEqual([]);
    expect(result.open).toHaveLength(0);
  });

  it("prepare keeps an existing worktree cwd instead of replacing it with the project path", async () => {
    const result = await run({}, (fixture) =>
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
    expect(result.workspace).toEqual({ cwd: "/tmp/pie-worktree", gitBranch: "pie/test" });
    expect(result.cwd).toBe("/tmp/pie-worktree");
  });

  it("getMessages reads history through the persisted worktree cwd", async () => {
    const history: UIMessage[] = [{ id: "m1", role: "user", parts: [] }];
    const result = await run({ coldHistory: history }, (fixture) =>
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
    expect(result.workspace).toEqual({ cwd: "/tmp/pie-worktree", gitBranch: "pie/test" });
    expect(result.messages).toEqual(history);
  });

  it("prepare fails with SessionNotFound for an unknown session", async () => {
    const err = await run({}, (fixture) =>
      Effect.flip(fixture.service.prepare({ projectId: "proj-a", sessionId: "missing" })),
    );
    expect(err._tag).toBe("SessionNotFound");
  });

  it("close is a no-op when Pi was never opened", async () => {
    const closeSpy = await run({}, (fixture) =>
      Effect.gen(function* () {
        const { ref } = yield* fixture.service.create({ projectId: "proj-a", cwd: "/tmp/pie-app" });
        yield* fixture.service.close(ref);
        return fixture.spy.close;
      }),
    );
    expect(closeSpy).toEqual([]);
  });

  it("delete removes metadata even when Pi was never opened", async () => {
    const result = await run({}, (fixture) =>
      Effect.gen(function* () {
        const { ref } = yield* fixture.service.create({ projectId: "proj-a", cwd: "/tmp/pie-app" });
        yield* fixture.service.delete(ref);
        const listed = yield* fixture.service.list("proj-a", false);
        return { listed, closeSpy: fixture.spy.close };
      }),
    );
    expect(result.closeSpy).toEqual([]);
    expect(result.listed).toHaveLength(0);
  });

  it("list returns one summary per session, keyed by server sessionId", async () => {
    const result = await run({}, (fixture) =>
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
    expect(result.listed).toHaveLength(2);
    expect(result.listed.map((summary) => summary.sessionId).toSorted()).toEqual(
      [result.a.sessionId, result.b.sessionId].toSorted(),
    );
    // We own the record, so a session we created reads as history-available.
    expect(result.listed.every((summary) => summary.historyAvailable)).toBe(true);
    expect(result.listed.every((summary) => !summary.archived)).toBe(true);
  });

  it("archives and restores a session, publishing each changed state", async () => {
    const result = await run({}, (fixture) =>
      Effect.gen(function* () {
        const { ref } = yield* fixture.service.create({ projectId: "proj-a", cwd: "/tmp/pie-app" });
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

    expect(result.archived[0]?.archived).toBe(true);
    expect(result.activeWhileArchived).toEqual([]);
    expect(result.restored[0]?.archived).toBe(false);
    expect(result.archivedAfterRestore).toEqual([]);
    expect(
      result.items.map((item) =>
        item.type === "event" && item.event.type === "session.archived"
          ? item.event.archived
          : undefined,
      ),
    ).toEqual([true, false]);
  });

  it("getMessages returns empty for a session Pi has never opened", async () => {
    const messages = await run({}, (fixture) =>
      Effect.gen(function* () {
        const { ref } = yield* fixture.service.create({ projectId: "proj-a", cwd: "/tmp/pie-app" });
        return yield* fixture.service.getMessages(ref);
      }),
    );
    expect(messages).toEqual([]);
  });

  it("getMessages reopens a closed session and reads through the live instance", async () => {
    const history: UIMessage[] = [{ id: "m1", role: "user", parts: [] }];
    const result = await run({ history }, (fixture) =>
      Effect.gen(function* () {
        const { ref } = yield* fixture.service.create({ projectId: "proj-a", cwd: "/tmp/pie-app" });
        yield* fixture.service.prompt({ ref, parts: [{ type: "text", text: "hello" }] });
        yield* Effect.sleep("50 millis");
        yield* fixture.service.close(ref);
        const messages = yield* fixture.service.getMessages(ref);
        return { messages, resume: fixture.spy.resume };
      }),
    );
    expect(result.resume).toEqual([{ sessionId: "native-1", cwd: "/tmp/pie-app" }]);
    expect(result.messages).toEqual(history);
  });

  const fourTurnHistory: UIMessage[] = [
    { id: "u1", role: "user", parts: [] },
    { id: "a1", role: "assistant", parts: [] },
    { id: "u2", role: "user", parts: [] },
    { id: "a2", role: "assistant", parts: [] },
  ];

  // The drain into the projection is async; poll until it has seen the turn.
  const waitForTurn = (
    fixture: Fixture,
    ref: SessionRef,
    done: (turn: { complete: boolean } | null) => boolean,
  ): Effect.Effect<void> =>
    Effect.gen(function* () {
      while (true) {
        const turn = yield* fixture.service
          .getSnapshot(ref)
          .pipe(Effect.map((snapshot) => snapshot.activeTurn));
        if (done(turn)) return;
        yield* Effect.sleep("10 millis");
      }
    });

  it("archives a running session and closes its live instance", async () => {
    const result = await run({ turn: "open" }, (fixture) =>
      Effect.gen(function* () {
        const { ref } = yield* fixture.service.create({ projectId: "proj-a", cwd: "/tmp/pie-app" });
        yield* fixture.service.prompt({ ref, parts: [{ type: "text", text: "go" }] });
        yield* Effect.sleep("50 millis");
        yield* waitForTurn(fixture, ref, (turn) => turn !== null && !turn.complete);
        yield* fixture.service.archive(ref, true);
        const active = yield* fixture.service.list("proj-a", false);
        const archived = yield* fixture.service.list("proj-a", true);
        return { active, archived, closed: fixture.spy.close.slice() };
      }),
    );

    expect(result.active).toEqual([]);
    expect(result.archived).toHaveLength(1);
    expect(result.archived[0]?.status).toBeUndefined();
    expect(result.closed).toEqual(["native-1"]);
  });

  it("getMessages trims the last user segment while a turn is in flight", async () => {
    const messages = await run({ history: fourTurnHistory, turn: "open" }, (fixture) =>
      Effect.gen(function* () {
        const { ref } = yield* fixture.service.create({ projectId: "proj-a", cwd: "/tmp/pie-app" });
        yield* fixture.service.prompt({ ref, parts: [{ type: "text", text: "go" }] });
        yield* Effect.sleep("50 millis");
        yield* waitForTurn(fixture, ref, (turn) => turn !== null && !turn.complete);
        return yield* fixture.service.getMessages(ref);
      }),
    );
    expect(messages.map((message) => message.id)).toEqual(["u1", "a1"]);
  });

  it("getMessages does not trim for a finished turn's retained buffer", async () => {
    const messages = await run({ history: fourTurnHistory, turn: "finished" }, (fixture) =>
      Effect.gen(function* () {
        const { ref } = yield* fixture.service.create({ projectId: "proj-a", cwd: "/tmp/pie-app" });
        yield* fixture.service.prompt({ ref, parts: [{ type: "text", text: "go" }] });
        yield* Effect.sleep("50 millis");
        yield* waitForTurn(fixture, ref, (turn) => turn?.complete === true);
        return yield* fixture.service.getMessages(ref);
      }),
    );
    expect(messages.map((message) => message.id)).toEqual(["u1", "a1", "u2", "a2"]);
  });

  it("getMessages reads cold through the adapter without starting anything", async () => {
    const history: UIMessage[] = [{ id: "m1", role: "user", parts: [] }];
    const result = await run({ coldHistory: history }, (fixture) =>
      Effect.gen(function* () {
        const { ref } = yield* fixture.service.create({ projectId: "proj-a", cwd: "/tmp/pie-app" });
        const stored = yield* fixture.repo.read(ref.projectId, ref.sessionId);
        yield* fixture.repo.write({ ...stored, agentSessionId: "native-already" });
        yield* fixture.service.close(ref);
        const messages = yield* fixture.service.getMessages(ref);
        return { messages, resume: fixture.spy.resume };
      }),
    );
    expect(result.messages).toEqual(history);
    // A harness that can read its own transcript is never asked for a process.
    expect(result.resume).toEqual([]);
  });

  it("interrupt succeeds with nothing running instead of starting an agent", async () => {
    const result = await run({}, (fixture) =>
      Effect.gen(function* () {
        const { ref } = yield* fixture.service.create({ projectId: "proj-a", cwd: "/tmp/pie-app" });
        yield* fixture.service.close(ref);
        yield* fixture.service.interrupt(ref);
        return fixture.spy.resume;
      }),
    );
    // The turn it would have stopped died with the process; resuming one in
    // order to interrupt it would be absurd.
    expect(result).toEqual([]);
  });

  it("respondToAgentRequest reports the request as gone with nothing running", async () => {
    const result = await run({}, (fixture) =>
      Effect.gen(function* () {
        const { ref } = yield* fixture.service.create({ projectId: "proj-a", cwd: "/tmp/pie-app" });
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
    expect(result.err._tag).toBe("AgentRequestUnavailable");
    expect(result.resume).toEqual([]);
  });

  // The bug this whole shape exists for: a browser left open across a server
  // restart used to hit SESSION_NOT_ACTIVE on every snapshot and retry forever,
  // because nothing on the observation path could make the error go away.
  it("a restarted server answers for a session it has never touched", async () => {
    const result = await run({}, (fixture) =>
      Effect.gen(function* () {
        const { ref } = yield* fixture.service.create({ projectId: "proj-a", cwd: "/tmp/pie-app" });
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
    expect(result.status).toEqual({ phase: "idle" });
    expect(result.snapshot.cursor).toBe(0);
    expect(result.snapshot.activeTurn).toBeNull();
    // Never opened on the previous process either — no agentSessionId, no transcript.
    expect(result.messages).toEqual([]);
    // … a session nothing has touched carries no status at all, so the sidebar
    // does not light up every row as active …
    expect(result.listed).toHaveLength(1);
    expect(result.listed[0]?.status).toBeUndefined();
    // … and none of it started an agent until the first prompt.
    expect(result.spy.open).toHaveLength(0);
    expect(result.spy.resume).toEqual([]);
  });

  // `turn: "finished"` keeps the fake's event stream open, which is what a real
  // runtime does: a stream that ends means the agent is done and the session
  // lets it go, so an empty one would be released between the two prompts.
  it("the first prompt after a restart starts exactly one agent", async () => {
    const result = await run({ turn: "finished" }, (fixture) =>
      Effect.gen(function* () {
        const { ref } = yield* fixture.service.create({ projectId: "proj-a", cwd: "/tmp/pie-app" });
        const restarted = yield* fixture.restart;
        yield* restarted.service.prepare(ref);

        yield* restarted.service.prompt({ ref, parts: [{ type: "text", text: "hello" }] });
        yield* Effect.sleep("50 millis");
        yield* restarted.service.prompt({ ref, parts: [{ type: "text", text: "again" }] });
        yield* Effect.sleep("50 millis");
        return fixture.spy;
      }),
    );
    // First prompt opens Pi; second reuses the live runtime.
    expect(result.open).toEqual([{ cwd: "/tmp/pie-app" }]);
    expect(result.resume).toEqual([]);
  });

  it("titles a session from its first prompt, collapsing whitespace", async () => {
    const listed = await run({}, (fixture) =>
      Effect.gen(function* () {
        const { ref } = yield* fixture.service.create({ projectId: "proj-a", cwd: "/tmp/pie-app" });
        yield* fixture.service.prompt({
          ref,
          parts: [{ type: "text", text: "  Fix the  login  bug " }],
        });
        yield* Effect.sleep("50 millis");
        return yield* fixture.service.list("proj-a", false);
      }),
    );
    expect(listed).toHaveLength(1);
    expect(listed[0]?.title).toBe("Fix the login bug");
  });

  it("publishes session.updated with the collapsed title on the first prompt", async () => {
    const result = await run({}, (fixture) =>
      Effect.gen(function* () {
        const { ref } = yield* fixture.service.create({ projectId: "proj-a", cwd: "/tmp/pie-app" });
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
    expect(result).toHaveLength(1);
    const item = result[0];
    expect(item?.type).toBe("event");
    const event = item?.type === "event" ? item.event : undefined;
    expect(event && !isSessionScopedEvent(event)).toBe(true);
    expect(event?.type).toBe("session.updated");
    expect(event?.type === "session.updated" ? event.title : undefined).toBe("Fix the login bug");
  });

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

  it("broadcasts session.prompt.submitted echoing the client messageId", async () => {
    const event = await run({ turn: "open" }, (fixture) =>
      Effect.gen(function* () {
        const { ref } = yield* fixture.service.create({ projectId: "proj-a", cwd: "/tmp/pie-app" });
        return yield* takePromptSubmitted(fixture, ref, { messageId: "client-msg-1" });
      }),
    );
    expect(event).toMatchObject({
      type: "session.prompt.submitted",
      messageId: "client-msg-1",
      parts: [{ type: "text", text: "hello there" }],
    });
    // Shares the session's contiguous seq counter with harness events.
    expect(event && isSessionScopedEvent(event) ? event.seq : 0).toBeGreaterThan(0);
  });

  it("retains the accepted prompt in the runtime snapshot for mid-turn joiners", async () => {
    const snapshot = await run({ turn: "open" }, (fixture) =>
      Effect.gen(function* () {
        const { ref } = yield* fixture.service.create({ projectId: "proj-a", cwd: "/tmp/pie-app" });
        yield* takePromptSubmitted(fixture, ref, { messageId: "client-msg-1" });
        return yield* fixture.service.getSnapshot(ref);
      }),
    );
    // `session.prompt.submitted` is never re-sent, so the snapshot is the only
    // recovery for a client that attaches after it fired.
    expect(snapshot.activePrompt).toMatchObject({
      messageId: "client-msg-1",
      parts: [{ type: "text", text: "hello there" }],
    });
    expect(snapshot.activePrompt?.seq).toBeGreaterThan(0);
  });

  it("compensates a harness-rejected prompt: rejected event follows, no retained phantom", async () => {
    const result = await run({ turn: "open", promptFails: true }, (fixture) =>
      Effect.gen(function* () {
        const { ref } = yield* fixture.service.create({ projectId: "proj-a", cwd: "/tmp/pie-app" });
        return yield* Effect.scoped(
          Effect.gen(function* () {
            const stream = yield* fixture.bus.subscribe({ kind: "session", ref });
            yield* fixture.service.prompt({
              ref,
              parts: [{ type: "text", text: "loser prompt" }],
              messageId: "loser-msg",
            });
            yield* Effect.sleep("50 millis");
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
              broadcast: Array.from(items).map((item) =>
                item.type === "event" ? item.event.type : item.type,
              ),
              activePrompt: snapshot.activePrompt,
            };
          }),
        );
      }),
    );
    expect(result.broadcast).toEqual(["session.prompt.submitted", "session.prompt.rejected"]);
    expect(result.activePrompt).toBeNull();
  });

  it("mints a messageId when the prompt carries none", async () => {
    const event = await run({ turn: "open" }, (fixture) =>
      Effect.gen(function* () {
        const { ref } = yield* fixture.service.create({ projectId: "proj-a", cwd: "/tmp/pie-app" });
        return yield* takePromptSubmitted(fixture, ref, {});
      }),
    );
    expect(event?.type).toBe("session.prompt.submitted");
    expect(event && "messageId" in event ? event.messageId : undefined).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("skips session.prompt.submitted when a follow-up does not start a turn", async () => {
    const result = await run({ turn: "open", promptStarted: false }, (fixture) =>
      Effect.gen(function* () {
        const { ref } = yield* fixture.service.create({ projectId: "proj-a", cwd: "/tmp/pie-app" });
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
    expect(result.receipt).toEqual({ turnId: "turn-1", started: false });
    expect(result.activePrompt).toBeNull();
    expect(result.prompts).toEqual([
      { parts: [{ type: "text", text: "later" }], delivery: "followUp" },
    ]);
  });

  it("fails the RPC when a queued follow-up's deliverPrompt fails", async () => {
    const result = await run({ turn: "open", promptFails: true }, (fixture) =>
      Effect.gen(function* () {
        const { ref } = yield* fixture.service.create({ projectId: "proj-a", cwd: "/tmp/pie-app" });
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
    expect(result.error._tag).toBe("TurnAlreadyRunning");
    expect(result.activePrompt).toBeNull();
    expect(result.prompts).toEqual([
      { parts: [{ type: "text", text: "later" }], delivery: "followUp" },
    ]);
  });

  it("emits session.prompt.submitted when a follow-up races to a new turn", async () => {
    const event = await run({ turn: "open", promptStarted: true }, (fixture) =>
      Effect.gen(function* () {
        const { ref } = yield* fixture.service.create({ projectId: "proj-a", cwd: "/tmp/pie-app" });
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
                  (item) => item.type === "event" && item.event.type === "session.prompt.submitted",
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
    expect(event).toMatchObject({
      type: "session.prompt.submitted",
      messageId: "raced-1",
      parts: [{ type: "text", text: "later" }],
    });
  });

  it("keeps the first prompt's title; later prompts don't rename", async () => {
    const listed = await run({}, (fixture) =>
      Effect.gen(function* () {
        const { ref } = yield* fixture.service.create({ projectId: "proj-a", cwd: "/tmp/pie-app" });
        yield* fixture.service.prompt({ ref, parts: [{ type: "text", text: "first" }] });
        yield* Effect.sleep("50 millis");
        yield* fixture.service.prompt({ ref, parts: [{ type: "text", text: "second" }] });
        yield* Effect.sleep("50 millis");
        return yield* fixture.service.list("proj-a", false);
      }),
    );
    expect(listed[0]?.title).toBe("first");
  });

  it("lists a session with no title until its first prompt", async () => {
    const listed = await run({}, (fixture) =>
      Effect.gen(function* () {
        yield* fixture.service.create({ projectId: "proj-a", cwd: "/tmp/pie-app" });
        return yield* fixture.service.list("proj-a", false);
      }),
    );
    expect(listed).toHaveLength(1);
    expect(listed[0]?.title).toBeUndefined();
  });

  // The lifecycle log is what a periodic read of `$PIE_HOME/logs` is for:
  // read on its own it says what was worked on, when, and where. It has to hold
  // together across the whole span of a session, so it is asserted as a
  // sequence rather than one line at a time.
  it("logs each lifecycle boundary once, in order, at info", async () => {
    const records: Array<LogRecord> = [];
    await run({}, (fixture) =>
      Effect.gen(function* () {
        const { ref } = yield* fixture.service.create({ projectId: "proj-a", cwd: "/tmp/pie-app" });
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
    expect(records.map((record) => record.annotations.event)).toEqual([
      "session.created",
      "session.archived",
      "session.deleted",
    ]);
    expect(records.every((record) => record.level === "INFO")).toBe(true);

    const created = records[0];
    const sessionId = created?.annotations.sessionId;
    expect(created?.annotations.cwd).toBe("/tmp/pie-app");
    expect(created?.annotations.agentSessionId).toBeUndefined();
    expect(created?.annotations.projectId).toBe("proj-a");
    // Every line carries the id, so one session's whole life greps out of a
    // file holding many.
    expect(sessionId).toBeTypeOf("string");
    expect(records.every((r) => r.annotations.sessionId === sessionId)).toBe(true);
  });

  // The identity is bound once at the service boundary, not repeated at each
  // log site — so a layer that has never heard of a `SessionRef` (an adapter
  // sees `cwd` and nothing else) still writes lines that grep out with the
  // session's own. This is the test that keeps that wrap from being "tidied"
  // back into per-site annotations.
  it("puts the session's identity on what the layers below it log", async () => {
    const records: Array<LogRecord> = [];
    await run({}, (fixture) =>
      Effect.gen(function* () {
        const { ref } = yield* fixture.service.create({ projectId: "proj-a", cwd: "/tmp/pie-app" });
        yield* fixture.service.prompt({ ref, parts: [{ type: "text", text: "hello" }] });
        // prompt forkDetachs Pi open; keep this scope alive until the adapter
        // log lands so the identity wrap is still on the fiber.
        yield* Effect.gen(function* () {
          for (let attempt = 0; attempt < 200; attempt += 1) {
            if (records.some((record) => record.message === "pi creating")) return;
            yield* Effect.sleep("10 millis");
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
    expect(adapterLine).toBeDefined();
    expect(adapterLine?.annotations.projectId).toBe("proj-a");
    expect(adapterLine?.annotations.sessionId).toMatch(UUID_RE);
  });

  // The rename used to be broadcast-only, so every client showed the new title
  // until the next list load read the old one back off disk.
  it("rename persists the title across a restart", async () => {
    const result = await run({}, (fixture) =>
      Effect.gen(function* () {
        const { ref } = yield* fixture.service.create({ projectId: "proj-a", cwd: "/tmp/pie-app" });
        yield* fixture.service.rename(ref, "Login bug");
        const listed = yield* fixture.service.list("proj-a", false);
        const restarted = yield* fixture.restart;
        return { listed, afterRestart: yield* restarted.service.list("proj-a", false) };
      }),
    );
    expect(result.listed[0]?.title).toBe("Login bug");
    expect(result.afterRestart[0]?.title).toBe("Login bug");
  });

  it("publishes session.closed on the global firehose when the runtime is torn down", async () => {
    const result = await run({}, (fixture) =>
      Effect.gen(function* () {
        const { ref } = yield* fixture.service.create({ projectId: "proj-a", cwd: "/tmp/pie-app" });
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
    expect(result).toEqual([
      {
        type: "event",
        event: {
          ref: expect.objectContaining({ projectId: "proj-a", sessionId: expect.any(String) }),
          type: "session.closed",
        },
      },
    ]);
  });

  it("publishes session.renamed per change, and nothing for a no-op rename", async () => {
    const result = await run({}, (fixture) =>
      Effect.gen(function* () {
        const { ref } = yield* fixture.service.create({ projectId: "proj-a", cwd: "/tmp/pie-app" });
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
    expect(
      result.map((item) =>
        item.type === "event" && item.event.type === "session.renamed"
          ? item.event.title
          : item.type,
      ),
    ).toEqual(["First title", "Second title"]);
  });

  // The title is the user's once they have chosen one: the first-prompt stamp
  // only fills a record that has none.
  it("keeps a hand-chosen title through the first prompt", async () => {
    const listed = await run({}, (fixture) =>
      Effect.gen(function* () {
        const { ref } = yield* fixture.service.create({ projectId: "proj-a", cwd: "/tmp/pie-app" });
        yield* fixture.service.rename(ref, "Login bug");
        yield* fixture.service.prompt({ ref, parts: [{ type: "text", text: "first" }] });
        yield* Effect.sleep("50 millis");
        return yield* fixture.service.list("proj-a", false);
      }),
    );
    expect(listed[0]?.title).toBe("Login bug");
  });

  it("preserves rename and archive changes made concurrently", async () => {
    const stored = await run({}, (fixture) =>
      Effect.gen(function* () {
        const { ref } = yield* fixture.service.create({ projectId: "proj-a", cwd: "/tmp/pie-app" });
        yield* Effect.all(
          [fixture.service.rename(ref, "Login bug"), fixture.service.archive(ref, true)],
          { concurrency: "unbounded" },
        );
        return yield* fixture.repo.read(ref.projectId, ref.sessionId);
      }),
    );
    expect(stored.title).toBe("Login bug");
    expect(stored.archived).toBe(true);
  });

  it("keeps the manual title when rename races the first prompt stamp", async () => {
    const listed = await run({}, (fixture) =>
      Effect.gen(function* () {
        const { ref } = yield* fixture.service.create({ projectId: "proj-a", cwd: "/tmp/pie-app" });
        yield* fixture.service.rename(ref, "Login bug");
        yield* fixture.service.prompt({ ref, parts: [{ type: "text", text: "automatic title" }] });
        yield* Effect.sleep("50 millis");
        return yield* fixture.service.list("proj-a", false);
      }),
    );
    expect(listed[0]?.title).toBe("Login bug");
  });

  it("does not let one slow session close stall another session's rename", async () => {
    let releaseClose!: () => void;
    let markCloseStarted!: () => void;
    const closeStarted = new Promise<void>((resolve) => {
      markCloseStarted = resolve;
    });
    const closeReleased = new Promise<void>((resolve) => {
      releaseClose = resolve;
    });

    const stored = await run(
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
          yield* Effect.sleep("50 millis");
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

    expect(stored.title).toBe("Still responsive");
  });

  it("setModel on an unopened session writes metadata without opening Pi", async () => {
    const result = await run({}, (fixture) =>
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

    expect(result.open).toEqual([]);
    expect(result.state).toEqual({ provider: "anthropic", modelId: "claude-sonnet-4-5" });
    expect(result.stored.provider).toBe("anthropic");
    expect(result.stored.modelId).toBe("claude-sonnet-4-5");
  });
});
