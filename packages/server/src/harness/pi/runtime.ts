import type {
  AgentModelState,
  AgentResponse,
  AgentThinkingLevel,
  AgentThinkingState,
  SessionCapabilities,
} from "@getpie/contract";
import { SessionCapabilitiesSchema } from "@getpie/contract";
import type { UIMessage } from "ai";
import { Effect, Queue, Ref, Scope, Stream } from "effect";
import type * as Cause from "effect/Cause";

import {
  AgentOpenError,
  AgentOperationError,
  AgentRequestUnavailable,
  type CapabilityUnsupported,
  SessionClosed,
  SessionNotResumable,
  TurnAlreadyRunning,
} from "../errors";
import type { SessionEnvelopeDraft, SessionEvent } from "../events/framework";
import { streamFromQueueOne } from "../queue-stream";
import type {
  CreateSessionInput,
  PromptReceipt,
  ResumeSessionInput,
  UserInput,
} from "../session-io";
import { entriesToUIMessages } from "./history";
import type { PiProcess } from "./process";
import type { PiUIMessageChunk } from "./ui-message";

export {
  CreateSessionInput,
  PromptReceipt,
  ResumeSessionInput,
  SessionCapabilities,
  SessionCapabilitiesSchema,
  UserInput,
};

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

/** Live Pi child for one agent session: events, prompt, interrupt, and close. */
export type PiAgentRuntime = {
  readonly sessionId: string;
  readonly events: Stream.Stream<SessionEnvelopeDraft, AgentOperationError>;
  readonly prompt: (
    input: UserInput,
  ) => Effect.Effect<PromptReceipt, SessionClosed | TurnAlreadyRunning | AgentOperationError>;
  readonly interrupt: Effect.Effect<void, SessionClosed | AgentOperationError>;
  readonly respondToAgentRequest: (
    requestId: string,
    response: AgentResponse,
  ) => Effect.Effect<void, AgentRequestUnavailable | AgentOperationError>;
  readonly getCapabilities: Effect.Effect<
    SessionCapabilities,
    CapabilityUnsupported | AgentOperationError
  >;
  readonly getMessages?: Effect.Effect<
    ReadonlyArray<UIMessage>,
    SessionClosed | AgentOperationError
  >;
  readonly getModelState?: Effect.Effect<AgentModelState, SessionClosed | AgentOperationError>;
  readonly setModel?: (model: {
    readonly provider: string;
    readonly modelId: string;
  }) => Effect.Effect<AgentModelState, SessionClosed | AgentOperationError>;
  readonly getThinkingState?: Effect.Effect<
    AgentThinkingState,
    SessionClosed | AgentOperationError
  >;
  readonly setThinkingLevel?: (
    level: AgentThinkingLevel,
  ) => Effect.Effect<AgentThinkingState, SessionClosed | AgentOperationError>;
  readonly close: Effect.Effect<void>;
};

export const makePiAgentRuntime = (
  process: PiProcess,
  sessionId: string,
): Effect.Effect<PiAgentRuntime, never, Scope.Scope> =>
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
                  process.session.abort(sessionId).pipe(Effect.catch(() => Effect.void)),
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
              Effect.andThen(
                process.session.abort(sessionId).pipe(Effect.catch(() => Effect.void)),
              ),
              Effect.andThen(Queue.end(events)),
              Effect.asVoid,
            ),
      ),
    );

    const interrupt: PiAgentRuntime["interrupt"] = Effect.gen(function* () {
      if (yield* Ref.get(closed)) return yield* new SessionClosed({ sessionId });
      yield* process.session
        .interrupt(sessionId)
        .pipe(Effect.mapError((cause) => operationError(sessionId, "interrupt", cause)));
    });

    yield* Scope.addFinalizer(scope, close);
    yield* process.session.awaitTermination(sessionId).pipe(
      Effect.catch((cause) => crash(cause)),
      Effect.forkIn(scope),
    );
    yield* Stream.runForEach(process.session.requestPermission(sessionId), (request) =>
      emit({ type: "session.request.asked", sessionId, request }),
    ).pipe(Effect.catch(crash), Effect.forkIn(scope));

    return {
      sessionId,
      events: streamFromQueueOne(events),
      prompt: (input) =>
        Effect.gen(function* () {
          if (yield* Ref.get(closed)) return yield* new SessionClosed({ sessionId });
          const prompt = yield* process.session
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
          const outcome = yield* Ref.make<"completed" | "canceled">("completed");
          const pump = Stream.runForEach(prompt.output, (chunk) =>
            (chunk.type === "abort" ? Ref.set(outcome, "canceled") : Effect.void).pipe(
              Effect.andThen(emit(chunk)),
              Effect.andThen(
                chunk.type === "finish"
                  ? Ref.set(finished, true).pipe(
                      Effect.andThen(Ref.get(outcome)),
                      Effect.flatMap((turnOutcome) =>
                        emit({
                          type: "session.turn.ended",
                          sessionId,
                          turnId: prompt.turnId,
                          outcome: turnOutcome,
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
        process.session.respondPermission(sessionId, requestId, response).pipe(
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
        supportsPermissions: false,
      }),
      getMessages: Effect.gen(function* () {
        if (yield* Ref.get(closed)) return yield* new SessionClosed({ sessionId });
        const { entries, leafId } = yield* process.session
          .getEntries(sessionId)
          .pipe(Effect.mapError((cause) => operationError(sessionId, "get-messages", cause)));
        return entriesToUIMessages(entries, leafId, sessionId);
      }),
      getModelState: Effect.gen(function* () {
        if (yield* Ref.get(closed)) return yield* new SessionClosed({ sessionId });
        return yield* process.session
          .getModelState(sessionId)
          .pipe(Effect.mapError((cause) => operationError(sessionId, "get-model-state", cause)));
      }),
      setModel: (model) =>
        Effect.gen(function* () {
          if (yield* Ref.get(closed)) return yield* new SessionClosed({ sessionId });
          return yield* process.session
            .setModel(sessionId, model)
            .pipe(Effect.mapError((cause) => operationError(sessionId, "set-model", cause)));
        }),
      getThinkingState: Effect.gen(function* () {
        if (yield* Ref.get(closed)) return yield* new SessionClosed({ sessionId });
        return yield* process.session
          .getThinkingState(sessionId)
          .pipe(Effect.mapError((cause) => operationError(sessionId, "get-thinking-state", cause)));
      }),
      setThinkingLevel: (level) =>
        Effect.gen(function* () {
          if (yield* Ref.get(closed)) return yield* new SessionClosed({ sessionId });
          return yield* process.session
            .setThinkingLevel(sessionId, level)
            .pipe(
              Effect.mapError((cause) => operationError(sessionId, "set-thinking-level", cause)),
            );
        }),
      close,
    } satisfies PiAgentRuntime;
  });

export const createPiAgentRuntime = (
  process: PiProcess,
  input: CreateSessionInput,
): Effect.Effect<PiAgentRuntime, AgentOpenError, Scope.Scope> =>
  process.session
    .create({
      cwd: input.cwd,
      ...(input.provider ? { provider: input.provider } : undefined),
      ...(input.modelId ? { modelId: input.modelId } : undefined),
      ...(input.thinkingLevel ? { thinkingLevel: input.thinkingLevel } : undefined),
    })
    .pipe(
      Effect.mapError((cause) => new AgentOpenError({ cause })),
      Effect.flatMap(({ sessionId }) => makePiAgentRuntime(process, sessionId)),
    );

export const resumePiAgentRuntime = (
  process: PiProcess,
  input: ResumeSessionInput,
): Effect.Effect<PiAgentRuntime, SessionNotResumable | AgentOpenError, Scope.Scope> =>
  process.session.resume({ sessionId: input.sessionId, cwd: input.cwd }).pipe(
    Effect.mapError((cause) =>
      cause instanceof SessionNotResumable ? cause : new AgentOpenError({ cause }),
    ),
    Effect.flatMap(({ sessionId }) => makePiAgentRuntime(process, sessionId)),
  );
