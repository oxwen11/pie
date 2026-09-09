import type {
  AgentRequest,
  AgentResponse,
  CompactionResult,
  AgentModelState,
  SessionPendingPrompt,
} from "@getpie/contract";
import { Deferred, Effect, Exit, Queue, Ref, Scope, Semaphore, Stream } from "effect";
import type * as Cause from "effect/Cause";
import type * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";
import { v7 as uuid } from "uuid";

import {
  AgentOperationError,
  AgentRequestUnavailable,
  PiTransportError,
  HarnessSessionNotFound,
  TurnAlreadyRunning,
} from "../errors";
import { isSessionEvent, type SessionEnvelopeBody } from "../events/framework";
import { drainQueue, streamFromQueueOne } from "../queue-stream";
import { entriesToUIMessages } from "./history";
import { toAgentModel, toAgentModelState, type PiModel } from "./model-mapping";
import type { RpcExtensionUIResponse, RpcSessionState, SessionEntries } from "./protocol";
import { buildUiRequest, declineUiResponse, mapUiResponse } from "./request";
import type { PiExecutable } from "./resolve-executable";
import { createPiTransform, type PiStreamItem } from "./transform";
import { makePiTransport, type PiTransport, type PiTransportFailure } from "./transport";

// Pi facade: one pie-pi-process per session (the process hosts a single
// AgentSession), unlike codex's shared app-server with thread demuxing. Crash
// isolation therefore comes for free — a dead process only takes down its own
// session — and there is no transport-generation bookkeeping.

const SESSION_QUEUE_CAPACITY = 1024;
const HANDSHAKE_TIMEOUT = "30 seconds";

type PendingRequest = {
  readonly deferred: Deferred.Deferred<unknown>;
  readonly declineValue: unknown;
  readonly settle: (response: AgentResponse) => unknown;
};

type PiTurnState =
  | { readonly _tag: "Idle" }
  | {
      readonly _tag: "Active";
      readonly turnId: string;
      readonly ended: Deferred.Deferred<void>;
      readonly abandoned: boolean;
      readonly interrupted: boolean;
    };

type RunEndTransition =
  | {
      readonly abandoned: true;
      readonly ended: Deferred.Deferred<void>;
      readonly interrupted: boolean;
    }
  | { readonly abandoned: false; readonly ended: undefined; readonly interrupted: boolean };

export type PiSessionFailure = PiTransportFailure | AgentOperationError;

type SessionState = {
  readonly sessionId: string;
  readonly scope: Scope.Closeable;
  readonly transport: PiTransport;
  readonly termination: Deferred.Deferred<never, PiSessionFailure>;
  readonly chunks: Queue.Queue<SessionEnvelopeBody, Cause.Done | AgentOperationError>;
  entryCursor: string | null;
  readonly requests: Queue.Queue<AgentRequest, Cause.Done>;
  readonly queueUpdates: Queue.Queue<SessionPendingPrompt, Cause.Done>;
  readonly pending: Ref.Ref<ReadonlyMap<string, PendingRequest>>;
  readonly requestGate: Semaphore.Semaphore;
  readonly turnState: Ref.Ref<PiTurnState>;
  readonly transform: ReturnType<typeof createPiTransform>;
};

export interface PiProcessOptions {
  readonly executable?: PiExecutable;
  readonly args?: ReadonlyArray<string>;
  readonly onSpawn?: (sessionId: string, pid: number) => void;
  readonly onExit?: (sessionId: string, pid: number) => void;
}

export interface PiProcessDependencies<R> {
  readonly makeTransport: (config: {
    readonly sessionId: string;
    readonly cwd?: string;
    readonly args?: ReadonlyArray<string>;
  }) => Effect.Effect<PiTransport, PiTransportError, R | Scope.Scope>;
  readonly onSpawn?: (sessionId: string, pid: number) => void;
  readonly onExit?: (sessionId: string, pid: number) => void;
}

export interface PiProcess {
  readonly session: {
    /** Single ordered stream, including compaction outside an agent turn. */
    readonly events: (
      sessionId: string,
    ) => Stream.Stream<SessionEnvelopeBody, HarnessSessionNotFound | AgentOperationError>;
    readonly create: (config: {
      readonly cwd: string;
      readonly provider?: string;
      readonly modelId?: string;
    }) => Effect.Effect<{ readonly sessionId: string }, PiTransportFailure>;
    readonly resume: (config: {
      readonly sessionId: string;
      readonly cwd?: string;
    }) => Effect.Effect<{ readonly sessionId: string }, PiTransportFailure>;
    // Pi decides whether to start or queue. `followUp` is the default;
    // `steer` injects before the next LLM call.
    readonly prompt: (input: {
      readonly sessionId: string;
      readonly text: string;
      readonly delivery?: "steer" | "followUp";
    }) => Effect.Effect<
      {
        readonly turnId: string;
        readonly started: boolean;
        readonly output: Stream.Stream<PiStreamItem, AgentOperationError>;
      },
      HarnessSessionNotFound | PiTransportFailure | AgentOperationError | TurnAlreadyRunning
    >;
    /**
     * Read the session's whole entry tree off the live child (`get_entries`).
     * No spawn: the caller (the manager, via ensure) guarantees the session is
     * already open — an unknown id fails, it does not open a process.
     */
    readonly getEntries: (
      sessionId: string,
    ) => Effect.Effect<SessionEntries, HarnessSessionNotFound | PiTransportFailure>;
    readonly requestPermission: (
      sessionId: string,
    ) => Stream.Stream<AgentRequest, HarnessSessionNotFound>;
    /** Pi `queue_update` events — not a transcript chunk. One consumer (the runtime). */
    readonly queueUpdates: (
      sessionId: string,
    ) => Stream.Stream<SessionPendingPrompt, HarnessSessionNotFound>;
    readonly awaitTermination: (
      sessionId: string,
    ) => Effect.Effect<never, HarnessSessionNotFound | PiSessionFailure>;
    readonly respondPermission: (
      sessionId: string,
      requestId: string,
      response: AgentResponse,
    ) => Effect.Effect<boolean, HarnessSessionNotFound | AgentRequestUnavailable>;
    readonly interrupt: (sessionId: string) => Effect.Effect<void, HarnessSessionNotFound>;
    // Pi has no per-item dequeue. Rewrite the whole queue: clear_queue, then
    // steer / follow_up each remaining line. Serialized with prompt via the
    // request gate so a concurrent send cannot interleave.
    readonly replaceQueue: (
      sessionId: string,
      pending: SessionPendingPrompt,
    ) => Effect.Effect<void, HarnessSessionNotFound | PiTransportFailure>;
    readonly abort: (sessionId: string) => Effect.Effect<void, HarnessSessionNotFound>;
    readonly getModelState: (
      sessionId: string,
    ) => Effect.Effect<AgentModelState, HarnessSessionNotFound | PiTransportFailure>;
    readonly setModel: (
      sessionId: string,
      model: { readonly provider: string; readonly modelId: string },
    ) => Effect.Effect<AgentModelState, HarnessSessionNotFound | PiTransportFailure>;
  };
}

/** @internal */
export const makePiProcessWithDependencies = <R>(
  dependencies: PiProcessDependencies<R>,
): Effect.Effect<PiProcess, never, R | Scope.Scope> =>
  Effect.gen(function* () {
    const ownerScope = yield* Scope.Scope;
    const buildContext = yield* Effect.context<R>();
    const sessions = yield* Ref.make(new Map<string, SessionState>());

    const getSession = (sessionId: string): Effect.Effect<SessionState, HarnessSessionNotFound> =>
      Ref.get(sessions).pipe(
        Effect.flatMap((current) => {
          const session = current.get(sessionId);
          return session
            ? Effect.succeed(session)
            : Effect.fail(new HarnessSessionNotFound({ sessionId }));
        }),
      );

    /** Remove the session from the table; false when another path got there first. */
    const unregister = (session: SessionState) =>
      Ref.modify(sessions, (current) => {
        if (current.get(session.sessionId) !== session) return [false, current] as const;
        const next = new Map(current);
        next.delete(session.sessionId);
        return [true, next] as const;
      });

    const settlePending = (session: SessionState) =>
      Ref.getAndSet(session.pending, new Map()).pipe(
        Effect.flatMap((pending) =>
          Effect.forEach(
            pending.values(),
            (request) => Deferred.succeed(request.deferred, request.declineValue),
            { discard: true },
          ),
        ),
      );

    const completeTurn = (session: SessionState) =>
      Ref.getAndSet(session.turnState, { _tag: "Idle" }).pipe(
        Effect.flatMap((turn) =>
          turn._tag === "Idle"
            ? Effect.void
            : Deferred.succeed(turn.ended, undefined).pipe(Effect.asVoid),
        ),
      );

    const overflowError = (session: SessionState) =>
      new AgentOperationError({
        sessionId: session.sessionId,
        operation: "event-queue-overflow",
        cause: new Error("Pi session event queue overflowed"),
      });

    const closeScope = (session: SessionState) =>
      Effect.forkIn(Scope.close(session.scope, Exit.void), ownerScope).pipe(Effect.asVoid);

    const evictOverflowedSession = (session: SessionState) => {
      const error = overflowError(session);
      return unregister(session).pipe(
        Effect.andThen(Deferred.fail(session.termination, error)),
        Effect.andThen(settlePending(session)),
        Effect.andThen(completeTurn(session)),
        Effect.andThen(Queue.end(session.requests)),
        Effect.andThen(Queue.end(session.queueUpdates)),
        Effect.andThen(Queue.fail(session.chunks, error)),
        Effect.andThen(closeScope(session)),
        Effect.asVoid,
      );
    };

    const crashSession = (session: SessionState, failure: PiSessionFailure) =>
      unregister(session).pipe(
        Effect.flatMap((removed) => {
          if (!removed) return Effect.void;
          return Deferred.fail(session.termination, failure).pipe(
            Effect.andThen(settlePending(session)),
            Effect.andThen(completeTurn(session)),
            Effect.andThen(Queue.end(session.requests)),
            Effect.andThen(Queue.end(session.queueUpdates)),
            Effect.andThen(
              Queue.offer(session.chunks, { type: "error", errorText: failure.message }),
            ),
            Effect.flatMap((accepted) =>
              accepted
                ? Queue.end(session.chunks).pipe(Effect.asVoid)
                : Queue.fail(session.chunks, overflowError(session)).pipe(Effect.asVoid),
            ),
            Effect.andThen(closeScope(session)),
          );
        }),
      );

    /** Crash cleanup runs outside the session scope — it closes that scope. */
    const reportCrash = (session: SessionState, failure: PiSessionFailure) =>
      Effect.forkIn(crashSession(session, failure), ownerScope).pipe(Effect.asVoid);

    const offerChunk = (session: SessionState, body: SessionEnvelopeBody) =>
      Queue.offer(session.chunks, body).pipe(
        Effect.flatMap((accepted) => (accepted ? Effect.void : evictOverflowedSession(session))),
      );

    const routeEvent = (
      session: SessionState,
      event: Parameters<SessionState["transform"]>[0],
    ): Effect.Effect<void> =>
      Effect.gen(function* () {
        if (event.type === "compaction_start") {
          yield* offerChunk(session, {
            type: "session.compaction.started",
            sessionId: session.sessionId,
            reason: event.reason,
          });
          return;
        }
        if (event.type === "compaction_end") {
          let result: CompactionResult;
          if (event.aborted) result = { outcome: "canceled" };
          else if (!event.result)
            result = { outcome: "failed", error: event.errorMessage ?? "Compaction failed" };
          else {
            const history = yield* session.transport
              .command<SessionEntries>({ type: "get_entries" })
              .pipe(
                Effect.timeout("10 seconds"),
                Effect.catch(() => Effect.succeed(null)),
              );
            const cursor =
              history?.entries.findIndex((entry) => entry.id === session.entryCursor) ?? -1;
            const compacted = history?.entries
              .slice(cursor + 1)
              .find(
                (entry) =>
                  entry.type === "compaction" &&
                  entry.firstKeptEntryId === event.result?.firstKeptEntryId &&
                  entry.summary === event.result?.summary,
              );
            if (compacted && history) {
              session.entryCursor = compacted.id;
              result = {
                outcome: "completed",
                messages: entriesToUIMessages(history.entries, compacted.id, session.sessionId),
              };
            } else
              result = { outcome: "failed", error: "Could not read the compacted conversation" };
          }
          yield* offerChunk(session, {
            type: "session.compaction.ended",
            sessionId: session.sessionId,
            result,
          });
          return;
        }
        if (event.type === "queue_update") {
          const accepted = yield* Queue.offer(session.queueUpdates, {
            steering: Array.from(event.steering),
            followUp: Array.from(event.followUp),
          });
          if (!accepted) yield* evictOverflowedSession(session);
          return;
        }

        const transformed: Array<PiStreamItem | undefined> = Array.from(session.transform(event));
        if (event.type === "agent_settled" && transformed.length === 0) {
          transformed.push(undefined);
        }
        for (const [index, chunk] of transformed.entries()) {
          const runEnd = event.type === "agent_settled" && index === transformed.length - 1;
          if (runEnd) {
            const transition = yield* Ref.modify<PiTurnState, RunEndTransition>(
              session.turnState,
              (current) =>
                current._tag === "Active" && current.abandoned
                  ? ([
                      { abandoned: true, ended: current.ended, interrupted: current.interrupted },
                      { _tag: "Idle" } as const,
                    ] as const)
                  : ([
                      {
                        abandoned: false,
                        ended: undefined,
                        interrupted: current._tag === "Active" && current.interrupted,
                      },
                      current,
                    ] as const),
            );
            if (transition.abandoned) {
              yield* drainQueue(session.chunks);
              if (transition.ended) yield* Deferred.succeed(transition.ended, undefined);
              continue;
            }
            if (transition.interrupted) {
              yield* offerChunk(session, { type: "abort" });
            }
            if (chunk === undefined) {
              yield* completeTurn(session);
              continue;
            }
          }

          if (chunk === undefined) continue;
          yield* offerChunk(session, chunk);
        }
      });

    const awaitAgentResponse = (
      session: SessionState,
      request: AgentRequest,
      settle: (response: AgentResponse) => unknown,
      declineValue: unknown,
    ) =>
      Effect.gen(function* () {
        const deferred = yield* Deferred.make<unknown>();
        const accepted = yield* session.requestGate.withPermit(
          Effect.gen(function* () {
            const turn = yield* Ref.get(session.turnState);
            if (turn._tag !== "Active" || turn.interrupted) return false;

            yield* Ref.update(session.pending, (current) =>
              new Map(current).set(request.id, { deferred, settle, declineValue }),
            );
            const offered = yield* Queue.offer(session.requests, request);
            if (!offered) {
              yield* Ref.update(session.pending, (current) => {
                const next = new Map(current);
                next.delete(request.id);
                return next;
              });
            }
            return offered;
          }),
        );
        if (!accepted) return declineValue;

        return yield* Deferred.await(deferred).pipe(
          Effect.onInterrupt(() =>
            Ref.update(session.pending, (current) => {
              const next = new Map(current);
              next.delete(request.id);
              return next;
            }),
          ),
        );
      });

    const handleUiRequest = (
      session: SessionState,
      request: Parameters<typeof buildUiRequest>[0],
    ): Effect.Effect<void> =>
      awaitAgentResponse(
        session,
        buildUiRequest(request),
        (response) => mapUiResponse(request, response),
        declineUiResponse(request),
      ).pipe(
        Effect.flatMap((result) =>
          session.transport
            // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- mapUiResponse/declineUiResponse return RpcExtensionUIResponse
            .respondUi(result as RpcExtensionUIResponse)
            .pipe(Effect.catch(() => Effect.void)),
        ),
      );

    const openSession = (
      sessionId: string,
      cwd?: string,
      spawnArgs?: ReadonlyArray<string>,
    ): Effect.Effect<{ readonly sessionId: string }, PiTransportFailure> =>
      Effect.gen(function* () {
        const scope = yield* Scope.fork(ownerScope, "sequential");
        return yield* Effect.gen(function* () {
          const transport = yield* dependencies
            .makeTransport({
              sessionId,
              ...(cwd ? { cwd } : undefined),
              ...(spawnArgs && spawnArgs.length > 0 ? { args: spawnArgs } : undefined),
            })
            .pipe(Effect.provideService(Scope.Scope, scope), Effect.provideContext(buildContext));
          dependencies.onSpawn?.(sessionId, transport.pid);
          yield* Scope.addFinalizer(
            scope,
            Effect.sync(() => dependencies.onExit?.(sessionId, transport.pid)),
          );

          // Readiness handshake: pi's CLI front-end resolves the session (and
          // may exit with a human-readable error) before the RPC loop starts.
          yield* transport.command<RpcSessionState>({ type: "get_state" }).pipe(
            Effect.timeoutOrElse({
              duration: HANDSHAKE_TIMEOUT,
              orElse: () =>
                Effect.fail(
                  new PiTransportError({
                    operation: "handshake-timeout",
                    cause: new Error("Pi RPC get_state handshake timed out"),
                  }),
                ),
            }),
          );

          const history = yield* transport.command<SessionEntries>({ type: "get_entries" });
          const session: SessionState = {
            sessionId,
            scope,
            transport,
            termination: yield* Deferred.make<never, PiSessionFailure>(),
            entryCursor: history.entries.at(-1)?.id ?? null,
            chunks: yield* Queue.dropping<SessionEnvelopeBody, Cause.Done | AgentOperationError>(
              SESSION_QUEUE_CAPACITY,
            ),
            requests: yield* Queue.bounded<AgentRequest, Cause.Done>(SESSION_QUEUE_CAPACITY),
            queueUpdates: yield* Queue.dropping<SessionPendingPrompt, Cause.Done>(
              SESSION_QUEUE_CAPACITY,
            ),
            pending: yield* Ref.make<ReadonlyMap<string, PendingRequest>>(new Map()),
            requestGate: yield* Semaphore.make(1),
            turnState: yield* Ref.make<PiTurnState>({ _tag: "Idle" }),
            transform: createPiTransform(sessionId),
          };
          yield* Ref.update(sessions, (current) => new Map(current).set(sessionId, session));

          yield* Stream.runForEach(transport.events, (event) => routeEvent(session, event)).pipe(
            Effect.catch((error) => reportCrash(session, error)),
            Effect.forkIn(scope),
          );
          yield* Stream.runForEach(transport.uiRequests, (request) =>
            Effect.forkIn(handleUiRequest(session, request), scope).pipe(Effect.asVoid),
          ).pipe(
            Effect.catch((error) => reportCrash(session, error)),
            Effect.forkIn(scope),
          );
          yield* transport.awaitTermination.pipe(
            Effect.catch((error) => reportCrash(session, error)),
            Effect.forkIn(scope),
          );

          return { sessionId };
        }).pipe(
          Effect.mapError((error) =>
            error instanceof PiTransportError ||
            error instanceof AgentOperationError ||
            (typeof error === "object" && error !== null && "_tag" in error)
              ? error
              : new PiTransportError({ operation: "open-session", cause: error }),
          ),
          Effect.onError(() => Scope.close(scope, Exit.void)),
        );
      });

    const interrupt = (sessionId: string): Effect.Effect<void, HarnessSessionNotFound> =>
      Effect.gen(function* () {
        const session = yield* getSession(sessionId);
        const active = yield* session.requestGate.withPermit(
          Ref.modify(session.turnState, (turn) =>
            turn._tag === "Active"
              ? [true, { ...turn, interrupted: true } as const]
              : [false, turn],
          ).pipe(Effect.tap((isActive) => (isActive ? settlePending(session) : Effect.void))),
        );
        if (!active) return;
        yield* session.transport.command({ type: "abort" }).pipe(Effect.catch(() => Effect.void));
        yield* session.requestGate.withPermit(settlePending(session));
      });

    const abort = (sessionId: string): Effect.Effect<void, HarnessSessionNotFound> =>
      getSession(sessionId).pipe(
        Effect.flatMap((session) =>
          unregister(session).pipe(
            Effect.andThen(settlePending(session)),
            Effect.andThen(completeTurn(session)),
            Effect.andThen(Queue.end(session.requests)),
            Effect.andThen(Queue.end(session.queueUpdates)),
            Effect.andThen(Queue.end(session.chunks)),
            Effect.andThen(closeScope(session)),
            Effect.asVoid,
          ),
        ),
      );

    const sessionEvents = (session: SessionState) =>
      streamFromQueueOne(session.chunks).pipe(
        Stream.tap((body) => (body.type === "finish" ? completeTurn(session) : Effect.void)),
      );

    return {
      session: {
        events: (sessionId) => Stream.unwrap(getSession(sessionId).pipe(Effect.map(sessionEvents))),
        create: (config) => {
          const spawnArgs =
            config.provider && config.modelId
              ? ["--provider", config.provider, "--model", config.modelId]
              : undefined;
          return openSession(uuid(), config.cwd, spawnArgs);
        },
        resume: (config) => openSession(config.sessionId, config.cwd),
        prompt: (input) =>
          Effect.gen(function* () {
            const session = yield* getSession(input.sessionId);
            return yield* session.requestGate.withPermit(
              Effect.uninterruptibleMask((restore) =>
                Effect.gen(function* () {
                  const admission = yield* restore(
                    session.transport.command<{ readonly started: boolean }>({
                      type: "prompt",
                      message: input.text,
                      streamingBehavior: input.delivery ?? "followUp",
                    }),
                  );

                  if (!admission.started) {
                    const active = yield* Ref.get(session.turnState);
                    if (active._tag === "Active") {
                      return {
                        turnId: active.turnId,
                        started: false,
                        output: Stream.empty,
                      };
                    }
                    return yield* new AgentOperationError({
                      sessionId: input.sessionId,
                      operation: "prompt-admission-state",
                      cause: new Error("Pi queued a prompt without an active server turn"),
                    });
                  }

                  const previous = yield* Ref.get(session.turnState);
                  if (previous._tag === "Active") {
                    yield* restore(Deferred.await(previous.ended)).pipe(
                      Effect.timeoutOrElse({
                        duration: "2 seconds",
                        orElse: () =>
                          Effect.fail(
                            new AgentOperationError({
                              sessionId: input.sessionId,
                              operation: "wait-for-finish-consumption",
                              cause: new Error("Timed out waiting for the previous Pi stream"),
                            }),
                          ),
                      }),
                    );
                  }

                  const turnId = uuid();
                  const ended = yield* Deferred.make<void>();
                  yield* Ref.set(session.turnState, {
                    _tag: "Active",
                    turnId,
                    ended,
                    abandoned: false,
                    interrupted: false,
                  });
                  yield* Queue.offer(session.chunks, {
                    type: "session.turn.started",
                    sessionId: input.sessionId,
                    turnId,
                  });

                  const abandonTurn = Ref.update(session.turnState, (current) =>
                    current._tag === "Active" && current.turnId === turnId
                      ? { ...current, abandoned: true }
                      : current,
                  );

                  return {
                    turnId,
                    started: true,
                    output: sessionEvents(session).pipe(
                      Stream.filter(
                        (body): body is PiStreamItem =>
                          !isSessionEvent(body) || body.type === "session.prompt.submitted",
                      ),
                      Stream.takeUntil((chunk) => chunk.type === "finish"),
                      Stream.ensuring(abandonTurn),
                    ),
                  };
                }),
              ).pipe(
                Effect.onInterrupt(() =>
                  interrupt(input.sessionId).pipe(Effect.catch(() => Effect.void)),
                ),
              ),
            );
          }),
        getEntries: (sessionId) =>
          getSession(sessionId).pipe(
            Effect.flatMap((session) =>
              session.transport.command<SessionEntries>({ type: "get_entries" }),
            ),
          ),
        requestPermission: (sessionId) =>
          Stream.unwrap(
            getSession(sessionId).pipe(
              Effect.map((session) => streamFromQueueOne(session.requests)),
            ),
          ),
        queueUpdates: (sessionId) =>
          Stream.unwrap(
            getSession(sessionId).pipe(
              Effect.map((session) => streamFromQueueOne(session.queueUpdates)),
            ),
          ),
        awaitTermination: (sessionId) =>
          getSession(sessionId).pipe(
            Effect.flatMap((session) => Deferred.await(session.termination)),
          ),
        respondPermission: (sessionId, requestId, response) =>
          Effect.gen(function* () {
            const session = yield* getSession(sessionId);
            const pending = yield* Ref.modify(session.pending, (current) => {
              const request = current.get(requestId);
              if (!request) return [undefined, current] as const;
              const next = new Map(current);
              next.delete(requestId);
              return [request, next] as const;
            });
            if (!pending) {
              return yield* new AgentRequestUnavailable({ sessionId, requestId });
            }
            yield* Deferred.succeed(pending.deferred, pending.settle(response));
            return true;
          }),
        interrupt,
        replaceQueue: (sessionId, pending) =>
          getSession(sessionId).pipe(
            Effect.flatMap((session) =>
              session.requestGate.withPermit(
                Effect.gen(function* () {
                  yield* session.transport.command<{
                    readonly steering: ReadonlyArray<string>;
                    readonly followUp: ReadonlyArray<string>;
                  }>({ type: "clear_queue" });
                  for (const message of pending.steering) {
                    yield* session.transport.command({ type: "steer", message });
                  }
                  for (const message of pending.followUp) {
                    yield* session.transport.command({ type: "follow_up", message });
                  }
                }),
              ),
            ),
          ),
        abort,
        getModelState: (sessionId) =>
          getSession(sessionId).pipe(
            Effect.flatMap((session) =>
              session.transport.command<RpcSessionState>({ type: "get_state" }),
            ),
            Effect.map(toAgentModelState),
          ),
        setModel: (sessionId, model) =>
          getSession(sessionId).pipe(
            Effect.flatMap((session) =>
              session.requestGate.withPermit(
                session.transport.command<PiModel>({
                  type: "set_model",
                  provider: model.provider,
                  modelId: model.modelId,
                }),
              ),
            ),
            Effect.map(toAgentModel),
          ),
      },
    } satisfies PiProcess;
  });

export const makePiProcess = (
  options: PiProcessOptions = {},
): Effect.Effect<PiProcess, never, ChildProcessSpawner.ChildProcessSpawner | Scope.Scope> =>
  makePiProcessWithDependencies({
    onSpawn: options.onSpawn,
    onExit: options.onExit,
    makeTransport: (config) => {
      const args = [...(options.args ?? []), ...(config.args ?? [])];
      return makePiTransport({
        ...(options.executable ? { executable: options.executable } : undefined),
        sessionId: config.sessionId,
        ...(config.cwd ? { cwd: config.cwd } : undefined),
        ...(args.length > 0 ? { args } : undefined),
      });
    },
  });
