import assert from "node:assert/strict";

import { it } from "@effect/vitest";
import { Deferred, Effect, Fiber, Queue, Ref, Stream } from "effect";

import { AgentOperationError } from "../../../src/harness/errors";
import type { SessionEnvelopeDraft } from "../../../src/harness/events/framework";
import type { PiProcess } from "../../../src/harness/pi/process";
import { makePiAgentRuntime } from "../../../src/harness/pi/runtime";
import type { PiUIMessageChunk } from "../../../src/harness/pi/ui-message";
import { streamFromQueueOne } from "../../../src/harness/queue-stream";

const SESSION_ID = "session-1";
const TURN_ID = "turn-1";
const PROMPT = { parts: [{ type: "text" as const, text: "hello" }] };

const unexpected = () => Effect.die("unexpected");

const makeFakeProcess = Effect.gen(function* () {
  const termination = yield* Deferred.make<never, AgentOperationError>();
  const output = yield* Queue.bounded<PiUIMessageChunk>(32);
  const abortCalls = yield* Ref.make(0);

  const process: PiProcess = {
    session: {
      create: () => unexpected(),
      resume: () => unexpected(),
      prompt: () =>
        Effect.succeed({
          turnId: TURN_ID,
          started: true,
          output: streamFromQueueOne(output),
        }),
      getEntries: () => unexpected(),
      requestPermission: () => Stream.empty,
      awaitTermination: () => Deferred.await(termination),
      respondPermission: () => unexpected(),
      interrupt: () => unexpected(),
      abort: () => Ref.update(abortCalls, (count) => count + 1),
      getModelState: () => unexpected(),
      setModel: () => unexpected(),
    },
  };

  return { process, termination, output, abortCalls };
});

const collectEvents = (events: Stream.Stream<SessionEnvelopeDraft, AgentOperationError>) =>
  Effect.gen(function* () {
    const bodies = yield* Ref.make<Array<SessionEnvelopeDraft["body"]>>([]);
    const fiber = yield* Stream.runForEach(events, (event) =>
      Ref.update(bodies, (current) => [...current, event.body]),
    ).pipe(Effect.forkChild);
    return {
      bodies,
      join: Fiber.join(fiber),
    };
  });

const typesOf = (bodies: ReadonlyArray<SessionEnvelopeDraft["body"]>) =>
  bodies.map((body) => body.type);

it.effect("close with no active turn ends events and aborts once", () =>
  Effect.gen(function* () {
    const fake = yield* makeFakeProcess;
    const runtime = yield* makePiAgentRuntime(fake.process, SESSION_ID);
    const collected = yield* collectEvents(runtime.events);

    yield* runtime.close;
    yield* collected.join;

    assert.deepEqual(yield* Ref.get(collected.bodies), []);
    assert.equal(yield* Ref.get(fake.abortCalls), 1);
  }),
);

it.effect("close during an open turn emits canceled and aborts once", () =>
  Effect.gen(function* () {
    const fake = yield* makeFakeProcess;
    const runtime = yield* makePiAgentRuntime(fake.process, SESSION_ID);
    const collected = yield* collectEvents(runtime.events);

    yield* runtime.prompt(PROMPT);
    yield* runtime.close;
    yield* collected.join;

    const bodies = yield* Ref.get(collected.bodies);
    assert.deepEqual(typesOf(bodies), ["session.turn.started", "session.turn.ended"]);
    const ended = bodies[1];
    assert.equal(ended?.type, "session.turn.ended");
    if (ended?.type === "session.turn.ended") {
      assert.equal(ended.outcome, "canceled");
      assert.equal(ended.turnId, TURN_ID);
    }
    assert.equal(yield* Ref.get(fake.abortCalls), 1);
  }),
);

it.effect("a failed awaitTermination crashes an open turn as failed", () =>
  Effect.gen(function* () {
    const fake = yield* makeFakeProcess;
    const runtime = yield* makePiAgentRuntime(fake.process, SESSION_ID);
    const collected = yield* collectEvents(runtime.events);

    yield* runtime.prompt(PROMPT);
    yield* Deferred.fail(
      fake.termination,
      new AgentOperationError({
        sessionId: SESSION_ID,
        operation: "await-termination",
        cause: new Error("process died"),
      }),
    );
    yield* collected.join;

    const bodies = yield* Ref.get(collected.bodies);
    assert.deepEqual(typesOf(bodies), [
      "session.turn.started",
      "session.crashed",
      "session.turn.ended",
    ]);
    const ended = bodies[2];
    assert.equal(ended?.type, "session.turn.ended");
    if (ended?.type === "session.turn.ended") {
      assert.equal(ended.outcome, "failed");
      assert.match(ended.error?.message ?? "", /process died/);
    }
    assert.equal(yield* Ref.get(fake.abortCalls), 1);
  }),
);

it.effect("close twice is a no-op after the first abort", () =>
  Effect.gen(function* () {
    const fake = yield* makeFakeProcess;
    const runtime = yield* makePiAgentRuntime(fake.process, SESSION_ID);
    const collected = yield* collectEvents(runtime.events);

    yield* runtime.close;
    yield* collected.join;
    const afterFirst = yield* Ref.get(collected.bodies);

    yield* runtime.close;
    assert.deepEqual(yield* Ref.get(collected.bodies), afterFirst);
    assert.equal(yield* Ref.get(fake.abortCalls), 1);
  }),
);

it.effect("a finish chunk completes the turn so a later close does not re-end it", () =>
  Effect.gen(function* () {
    const fake = yield* makeFakeProcess;
    const runtime = yield* makePiAgentRuntime(fake.process, SESSION_ID);
    const collected = yield* collectEvents(runtime.events);

    yield* runtime.prompt(PROMPT);
    yield* Queue.offer(fake.output, { type: "finish" });
    yield* Effect.eventually(
      Ref.get(collected.bodies).pipe(
        Effect.filterOrFail(
          (bodies) => bodies.some((body) => body.type === "session.turn.ended"),
          () => new Error("turn.ended not yet emitted"),
        ),
      ),
    );

    const beforeClose = yield* Ref.get(collected.bodies);
    yield* runtime.close;
    yield* collected.join;

    const bodies = yield* Ref.get(collected.bodies);
    assert.deepEqual(typesOf(beforeClose), [
      "session.turn.started",
      "finish",
      "session.turn.ended",
    ]);
    assert.deepEqual(typesOf(bodies), typesOf(beforeClose));
    const turnEnded = bodies[2];
    assert.equal(turnEnded?.type, "session.turn.ended");
    if (turnEnded?.type === "session.turn.ended") {
      assert.equal(turnEnded.outcome, "completed");
    }
    assert.equal(yield* Ref.get(fake.abortCalls), 1);
  }),
);
