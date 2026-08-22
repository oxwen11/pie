import { Effect, Queue, Ref, Scope, Stream } from "effect";
import type * as Cause from "effect/Cause";

import type {
  HarnessAgentAdapter,
  HarnessAgentRuntime,
  SessionInfoResult,
  UserInput,
} from "../adapter";
import {
  AgentOpenError,
  AgentOperationError,
  AgentRequestUnavailable,
  SessionClosed,
  SessionNotResumable,
  TurnAlreadyRunning,
} from "../errors";
import type { SessionEnvelopeDraft, SessionEvent } from "../events/framework";
import { streamFromQueueOne } from "../queue-stream";
import type { PiAgent } from "./agent";
import { entriesToUIMessages } from "./history";
import { checkPiAvailability } from "./resolve-executable";
import type { PiExecutable } from "./resolve-executable";
import type { PiUIMessageChunk } from "./ui-message";

const EVENT_QUEUE_CAPACITY = 1024;

const operationError = (sessionId: string, operation: string, cause: unknown) =>
  new AgentOperationError({ sessionId, operation, cause });

const toPromptText = (input: UserInput): string =>
  input.parts
    .map((part) =>
      part.type === "text"
        ? part.text
        : `i am current inspect target: ${part.data
            .map((target) => `@${target.file}:${target.line}:${target.column}`)
            .join(", ")}`,
    )
    .join("\n");

const makeRuntime = (
  agent: PiAgent,
  sessionId: string,
): Effect.Effect<HarnessAgentRuntime, never, Scope.Scope> =>
  Effect.gen(function* () {
    const scope = yield* Scope.Scope;
    const events = yield* Queue.bounded<SessionEnvelopeDraft, Cause.Done | AgentOperationError>(
      EVENT_QUEUE_CAPACITY,
    );
    const cursor = yield* Ref.make(0);
    const closed = yield* Ref.make(false);
    const activeTurn = yield* Ref.make<string | undefined>(undefined);

    const emit = (body: PiUIMessageChunk | SessionEvent) =>
      Queue.offer(events, { sessionId, body }).pipe(
        Effect.flatMap((accepted) =>
          accepted
            ? Ref.update(cursor, (current) => current + 1)
            : Effect.fail(
                operationError(sessionId, "publish-event", new Error("Event queue closed")),
              ),
        ),
      );

    const crash = (cause: unknown) =>
      Ref.getAndSet(closed, true).pipe(
        Effect.flatMap((alreadyClosed) =>
          alreadyClosed
            ? Effect.void
            : Ref.getAndSet(activeTurn, undefined).pipe(
                Effect.flatMap((turnId) =>
                  emit({ type: "session.crashed", sessionId, reason: String(cause) }).pipe(
                    Effect.andThen(
                      turnId
                        ? emit({
                            type: "session.turn.ended",
                            sessionId,
                            turnId,
                            outcome: "failed",
                            error: { message: String(cause), category: "unknown" },
                          })
                        : Effect.void,
                    ),
                  ),
                ),
                Effect.catch(() => Effect.void),
                Effect.andThen(
                  agent.session.abort(sessionId).pipe(Effect.catch(() => Effect.void)),
                ),
                Effect.andThen(Queue.end(events)),
                Effect.asVoid,
              ),
        ),
      );

    const close = Ref.getAndSet(closed, true).pipe(
      Effect.flatMap((alreadyClosed) =>
        alreadyClosed
          ? Effect.void
          : Ref.getAndSet(activeTurn, undefined).pipe(
              Effect.flatMap((turnId) =>
                turnId
                  ? emit({
                      type: "session.turn.ended",
                      sessionId,
                      turnId,
                      outcome: "canceled",
                    })
                  : Effect.void,
              ),
              Effect.catch(() => Effect.void),
              Effect.andThen(agent.session.abort(sessionId).pipe(Effect.catch(() => Effect.void))),
              Effect.andThen(Queue.end(events)),
              Effect.asVoid,
            ),
      ),
    );

    const interrupt: HarnessAgentRuntime["interrupt"] = Effect.gen(function* () {
      if (yield* Ref.get(closed)) return yield* new SessionClosed({ sessionId });
      yield* agent.session
        .interrupt(sessionId)
        .pipe(Effect.mapError((cause) => operationError(sessionId, "interrupt", cause)));
    });

    yield* Scope.addFinalizer(scope, close);
    yield* agent.session.awaitTermination(sessionId).pipe(
      Effect.catch((cause) => crash(cause)),
      Effect.forkIn(scope),
    );
    yield* Stream.runForEach(agent.session.requestPermission(sessionId), (request) =>
      emit({ type: "session.request.asked", sessionId, request }),
    ).pipe(Effect.catch(crash), Effect.forkIn(scope));

    return {
      sessionId,
      events: streamFromQueueOne(events),
      prompt: (input) =>
        Effect.gen(function* () {
          if (yield* Ref.get(closed)) return yield* new SessionClosed({ sessionId });
          const prompt = yield* agent.session
            .prompt({ sessionId, text: toPromptText(input) })
            .pipe(
              Effect.mapError((cause) =>
                cause instanceof TurnAlreadyRunning
                  ? cause
                  : operationError(sessionId, "prompt", cause),
              ),
            );
          const receipt = {
            turnId: prompt.turnId,
            cursor: yield* Ref.get(cursor),
            started: prompt.started,
          };
          if (prompt.started) {
            yield* Ref.set(activeTurn, prompt.turnId);
            yield* emit({ type: "session.turn.started", sessionId, turnId: prompt.turnId });
          }

          const finished = yield* Ref.make(false);
          const pump = Stream.runForEach(prompt.output, (chunk) =>
            emit(chunk).pipe(
              Effect.andThen(
                chunk.type === "finish"
                  ? Ref.set(finished, true).pipe(
                      Effect.andThen(
                        emit({
                          type: "session.turn.ended",
                          sessionId,
                          turnId: prompt.turnId,
                          outcome: "completed",
                        }).pipe(
                          Effect.andThen(
                            Ref.update(activeTurn, (current) =>
                              current === prompt.turnId ? undefined : current,
                            ),
                          ),
                        ),
                      ),
                    )
                  : Effect.void,
              ),
            ),
          ).pipe(
            Effect.flatMap(() => Ref.get(finished)),
            Effect.flatMap((didFinish) =>
              prompt.started && !didFinish
                ? crash(new Error("Pi turn ended without a finish event"))
                : Effect.void,
            ),
            Effect.catch(crash),
          );
          yield* Effect.forkIn(pump, scope);
          return receipt;
        }),
      interrupt,
      respondToAgentRequest: (requestId, response) =>
        agent.session.respondPermission(sessionId, requestId, response).pipe(
          Effect.mapError((cause) =>
            cause instanceof AgentRequestUnavailable
              ? cause
              : operationError(sessionId, "respond-to-request", cause),
          ),
          Effect.andThen(emit({ type: "session.request.replied", sessionId, requestId })),
        ),
      getCapabilities: Effect.succeed({
        supportsResume: true,
        supportsSteering: true,
        // Pi has no native tool gating — tools run unguarded; agent requests
        // only surface when a pi extension asks via ctx.ui.*.
        supportsPermissions: false,
      }),
      // Native history read: the live child returns its whole entry tree and
      // the fold rebuilds the current branch. SessionEntry never leaves here.
      getMessages: Effect.gen(function* () {
        if (yield* Ref.get(closed)) return yield* new SessionClosed({ sessionId });
        const { entries, leafId } = yield* agent.session
          .getEntries(sessionId)
          .pipe(Effect.mapError((cause) => operationError(sessionId, "get-messages", cause)));
        return entriesToUIMessages(entries, leafId, sessionId);
      }),
      getModelState: Effect.gen(function* () {
        if (yield* Ref.get(closed)) return yield* new SessionClosed({ sessionId });
        return yield* agent.session
          .getModelState(sessionId)
          .pipe(Effect.mapError((cause) => operationError(sessionId, "get-model-state", cause)));
      }),
      setModel: (model) =>
        Effect.gen(function* () {
          if (yield* Ref.get(closed)) return yield* new SessionClosed({ sessionId });
          return yield* agent.session
            .setModel(sessionId, model)
            .pipe(Effect.mapError((cause) => operationError(sessionId, "set-model", cause)));
        }),
      close,
    } satisfies HarnessAgentRuntime;
  });

export const makePiAdapter = (
  agent: PiAgent,
  options: { readonly executable?: PiExecutable } = {},
): HarnessAgentAdapter => ({
  descriptor: { name: "Pi" },
  checkAvailability: checkPiAvailability(options.executable ?? { command: "pi", prefixArgs: [] }),
  open: (input) =>
    agent.session.create({ cwd: input.cwd }).pipe(
      Effect.mapError((cause) => new AgentOpenError({ cause })),
      Effect.flatMap(({ sessionId }) => makeRuntime(agent, sessionId)),
    ),
  resume: (input) =>
    agent.session.resume({ sessionId: input.sessionId, cwd: input.cwd }).pipe(
      Effect.mapError((cause) =>
        cause instanceof SessionNotResumable ? cause : new AgentOpenError({ cause }),
      ),
      Effect.flatMap(({ sessionId }) => makeRuntime(agent, sessionId)),
    ),
  getSessionInfo: () => Effect.succeed<SessionInfoResult>({ _tag: "unsupported" }),
});
