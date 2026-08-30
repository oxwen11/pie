import type {
  SessionRef,
  SessionRuntimeSnapshot,
  SessionScopedEventBody,
  SessionStatus,
} from "@getpie/contract";
import { Context, Deferred, Effect, FileSystem, Layer, Ref, Scope } from "effect";

import { EventBus, type EventBusShape } from "../events/event-bus";
import {
  AgentOpenError,
  type CreateSessionError,
  HarnessSessionNotFound,
  type ResumeSessionError,
  SessionNotResumable,
} from "./errors";
import type { PiAgentShape } from "./pi/agent";
import { PiAgent } from "./pi/agent";
import type { PiAgentRuntime } from "./pi/runtime";
import { type AcquireRuntime, type PiAgentSessionShape, makePiAgentSession } from "./session";
import { initialSessionState, toSnapshot, toStatus } from "./session-fold";
import type { CreateSessionInput } from "./session-io";
import type { ResumeManagedSessionInput } from "./session-io";

/**
 * The sole owner of live session state: one {@link PiAgentSessionShape}
 * per ref, each optionally holding a runtime. The manager's own job is narrow —
 * keep the table, and turn "native session id + cwd" into the `acquire` a
 * the `acquire` a session runs when it decides it needs a runtime.
 *
 * It remains the single caller of `pi.create` / `pi.resume`: every
 * acquisition goes through one session's lifecycle lock, so Pi is never asked
 * to create the same session twice concurrently. That invariant is
 * load-bearing for pi, whose `openSession` blind-writes its own table.
 *
 * Vocabulary: everything here is addressed by {@link SessionRef}, which is
 * carried opaquely — stamped onto wire events and used as the map key — never
 * interpreted. The agent-native session id survives only as a value the
 * adapters trade in; adapters never see the ref.
 */

export type PiAgentSessionManagerShape = {
  /**
   * Open a fresh native session via the adapter and take ownership of it. The
   * one eager path: a session that does not exist yet has no native id to
   * resume by, so creating it *is* opening it.
   */
  readonly open: (
    input: CreateSessionInput,
    ref: SessionRef,
  ) => Effect.Effect<PiAgentRuntime, CreateSessionError>;
  /**
   * The session's runtime, resuming one via the adapter if it holds none.
   * Single-flight per session; a failure leaves the session observable and
   * lets a later call retry. This is the only path that starts a process for
   * an existing session.
   */
  readonly ensureRuntime: (
    input: ResumeManagedSessionInput,
    ref: SessionRef,
  ) => Effect.Effect<PiAgentRuntime, ResumeSessionError>;
  /**
   * The runtime a session already holds; fails when it holds none. Never
   * acquires — callers that merely want to talk to a running agent must not
   * start one.
   */
  readonly get: (ref: SessionRef) => Effect.Effect<PiAgentRuntime, HarnessSessionNotFound>;
  /** The same lookup as {@link get}, for callers that have something else to do
   * when nothing is running rather than an error to raise. */
  readonly peek: (ref: SessionRef) => Effect.Effect<PiAgentRuntime | undefined>;
  /**
   * Close and forget a session — runtime and session state alike; idempotent.
   * This is the only path that discards a crashed session (a crash alone
   * releases the runtime but keeps the session queryable at phase "crashed"
   * for reconnecting clients).
   */
  readonly close: (ref: SessionRef) => Effect.Effect<void>;
  /**
   * The status/snapshot of a session. Total on purpose: a ref with nothing
   * live in memory — the ordinary state of every persisted session after a
   * server restart — reads as idle at cursor 0 rather than failing. That is
   * what lets a client attach, snapshot, and subscribe without anything
   * starting a process on its behalf.
   *
   * Neither call creates a session; only the write paths do.
   */
  readonly status: (ref: SessionRef) => Effect.Effect<SessionStatus>;
  readonly snapshot: (ref: SessionRef) => Effect.Effect<SessionRuntimeSnapshot>;
  /**
   * The status of a session that is live in memory, or `undefined` when it is
   * not. The distinction `status` deliberately erases, for the one caller that
   * needs it: `list` must show an untouched session as having no status at
   * all, not as a freshly idle one.
   */
  readonly liveStatus: (ref: SessionRef) => Effect.Effect<SessionStatus | undefined>;
  /** True while deleting the Session would interrupt accepted work. */
  readonly isBusy: (ref: SessionRef) => Effect.Effect<boolean>;
  /**
   * Inject a server-originated session event into the session's stream — same
   * seq counter and fan-out as harness events (see session `emit`). A write,
   * so it materializes the session if this is the first thing to touch it.
   */
  readonly emit: (ref: SessionRef, body: SessionScopedEventBody) => Effect.Effect<void>;
};

export class PiAgentSessionManager extends Context.Service<
  PiAgentSessionManager,
  PiAgentSessionManagerShape
>()("PiAgentSessionManager") {}

/**
 * A live session, or the fact that one is on its way out. Both live in the
 * same table so "does this ref have a session" is a single atomic question:
 * anything that wants to write waits behind an in-flight close instead of
 * racing it, which is what keeps `pi.create` / `pi.resume` single-caller per
 * session even while one is being torn down.
 */
type SessionEntry =
  | { readonly _tag: "Live"; readonly session: PiAgentSessionShape }
  | { readonly _tag: "Closing"; readonly done: Deferred.Deferred<void> };

type CloseStep =
  | {
      readonly _tag: "Release";
      readonly session: PiAgentSessionShape;
      readonly done: Deferred.Deferred<void>;
    }
  | { readonly _tag: "Await"; readonly done: Deferred.Deferred<void> }
  | { readonly _tag: "Done" };

export const makePiAgentSessionManager = (
  pi: PiAgentShape,
  bus: EventBusShape,
): Effect.Effect<PiAgentSessionManagerShape, never, Scope.Scope | FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const ownerScope = yield* Scope.Scope;
    // An adapter's availability check reads the filesystem; bind it once here
    // so the manager's own methods stay R-free. `provideService` rather than
    // `provide(Effect.context())` — the latter captures the whole layer-build
    // context, `ownerScope` included, and wins the merge over a caller's.
    const fileSystem = yield* FileSystem.FileSystem;
    // Our sessionId → the session that owns its observable state.
    const sessions = yield* Ref.make<ReadonlyMap<string, SessionEntry>>(new Map());

    /** The session for a ref, on the write paths that are allowed to create
     * one. A session is a few Refs, so losing the creation race and discarding
     * the loser costs nothing — cheaper than serializing every lookup. */
    const sessionFor = (ref: SessionRef): Effect.Effect<PiAgentSessionShape> =>
      Effect.suspend(() =>
        Ref.get(sessions).pipe(
          Effect.flatMap((current) => {
            const entry = current.get(ref.sessionId);
            if (entry?._tag === "Live") return Effect.succeed(entry.session);
            if (entry?._tag === "Closing")
              return Deferred.await(entry.done).pipe(Effect.andThen(sessionFor(ref)));
            return makePiAgentSession(ref, bus).pipe(
              Effect.provideService(Scope.Scope, ownerScope),
              Effect.flatMap((candidate) =>
                Ref.modify(
                  sessions,
                  (
                    latest,
                  ): readonly [
                    PiAgentSessionShape | undefined,
                    ReadonlyMap<string, SessionEntry>,
                  ] => {
                    const raced = latest.get(ref.sessionId);
                    if (raced?._tag === "Live") return [raced.session, latest];
                    if (raced?._tag === "Closing") return [undefined, latest];
                    return [
                      candidate,
                      new Map(latest).set(ref.sessionId, { _tag: "Live", session: candidate }),
                    ];
                  },
                ),
              ),
              Effect.flatMap((session) => (session ? Effect.succeed(session) : sessionFor(ref))),
            );
          }),
        ),
      );

    /** Read through a live session, or answer for one that isn't there. One on
     * its way out reads as absent — its state is about to stop existing. */
    const withSession = <A>(
      ref: SessionRef,
      use: (session: PiAgentSessionShape) => Effect.Effect<A>,
      absent: A,
    ): Effect.Effect<A> =>
      Ref.get(sessions).pipe(
        Effect.flatMap((current) => {
          const entry = current.get(ref.sessionId);
          return entry?._tag === "Live" ? use(entry.session) : Effect.succeed(absent);
        }),
      );

    const withFileSystem = <A, E, R>(
      effect: Effect.Effect<A, E, R | FileSystem.FileSystem>,
    ): Effect.Effect<A, E, R> =>
      effect.pipe(Effect.provideService(FileSystem.FileSystem, fileSystem));

    /**
     * The heaviest thing this server does: `create`/`resume` is where an agent
     * CLI is actually spawned or an SDK handle established. It is also the
     * likeliest to fail — a CLI that is not installed, an expired login, a cwd
     * that vanished — and the failure reaches the user as a session that "does
     * nothing".
     *
     * Availability is checked inside PiAgent; the native span correlates
     * logs emitted during each acquisition. The Pi session id is attached after
     * PiAgent answers because it does not exist before then.
     */
    const acquireCreate = (input: CreateSessionInput): AcquireRuntime =>
      withFileSystem(pi.create(input)).pipe(
        Effect.tap((runtime) => Effect.annotateCurrentSpan("agentSessionId", runtime.sessionId)),
        Effect.withSpan("pi.create"),
      );

    const acquireResume = (input: ResumeManagedSessionInput): AcquireRuntime =>
      withFileSystem(pi.resume({ sessionId: input.sessionId, cwd: input.cwd })).pipe(
        Effect.tap((runtime) => Effect.annotateCurrentSpan("agentSessionId", runtime.sessionId)),
        Effect.withSpan("pi.resume"),
      );

    /** Acquire through a session, retrying against a fresh one when the session
     * we asked was released out from under us — `sessionFor` is what waits for
     * that release to finish, so the retry can never overlap it. */
    const acquireVia = (
      ref: SessionRef,
      acquire: AcquireRuntime,
    ): Effect.Effect<PiAgentRuntime, ResumeSessionError> =>
      sessionFor(ref).pipe(
        Effect.flatMap((session) => session.ensureRuntime(acquire)),
        Effect.flatMap((runtime) => (runtime ? Effect.succeed(runtime) : acquireVia(ref, acquire))),
      );

    const peek = (ref: SessionRef): Effect.Effect<PiAgentRuntime | undefined> =>
      withSession<PiAgentRuntime | undefined>(ref, (session) => session.peekRuntime, undefined);

    // The session stays in the table, marked closing, until its runtime is
    // gone: removing it first would let a concurrent write build a second
    // session for the same ref and resume it alongside the one still dying.
    const close = (ref: SessionRef): Effect.Effect<void> =>
      Ref.modify(sessions, (current): readonly [CloseStep, ReadonlyMap<string, SessionEntry>] => {
        const entry = current.get(ref.sessionId);
        if (!entry) return [{ _tag: "Done" }, current];
        if (entry._tag === "Closing") return [{ _tag: "Await", done: entry.done }, current];
        const done = Deferred.makeUnsafe<void>();
        return [
          { _tag: "Release", session: entry.session, done },
          new Map(current).set(ref.sessionId, { _tag: "Closing", done }),
        ];
      }).pipe(
        Effect.flatMap((step) => {
          if (step._tag === "Done") return Effect.void;
          if (step._tag === "Await") return Deferred.await(step.done);
          return step.session.releaseRuntime.pipe(
            Effect.ensuring(
              Ref.update(sessions, (current) => {
                const entry = current.get(ref.sessionId);
                if (entry?._tag !== "Closing" || entry.done !== step.done) return current;
                const next = new Map(current);
                next.delete(ref.sessionId);
                return next;
              }).pipe(Effect.andThen(Deferred.succeed(step.done, undefined))),
            ),
          );
        }),
      );

    yield* Scope.addFinalizer(
      ownerScope,
      Ref.get(sessions).pipe(
        Effect.flatMap((current) =>
          Effect.forEach(
            Array.from(current.values()).filter((entry) => entry._tag === "Live"),
            (entry) => entry.session.releaseRuntime,
            { concurrency: "unbounded", discard: true },
          ),
        ),
      ),
    );

    return {
      open: (input, ref) =>
        acquireVia(ref, acquireCreate(input)).pipe(
          // `AcquireRuntime` carries the resume union; the two members only a
          // resume can raise are unreachable here, so a sighting is an adapter
          // misbehaving and folds into AgentOpenError.
          Effect.mapError(
            (error): CreateSessionError =>
              error instanceof SessionNotResumable || error instanceof HarnessSessionNotFound
                ? new AgentOpenError({ cause: error })
                : error,
          ),
        ),
      ensureRuntime: (input, ref) => acquireVia(ref, acquireResume(input)),
      get: (ref) =>
        peek(ref).pipe(
          Effect.flatMap((runtime) =>
            runtime
              ? Effect.succeed(runtime)
              : Effect.fail(new HarnessSessionNotFound({ sessionId: ref.sessionId })),
          ),
        ),
      peek,
      close,
      status: (ref) => withSession(ref, (session) => session.status, toStatus(initialSessionState)),
      snapshot: (ref) =>
        withSession(ref, (session) => session.snapshot, toSnapshot(ref, initialSessionState)),
      liveStatus: (ref) =>
        withSession<SessionStatus | undefined>(ref, (session) => session.status, undefined),
      isBusy: (ref) => withSession(ref, (session) => session.isBusy, false),
      emit: (ref, body) => sessionFor(ref).pipe(Effect.flatMap((session) => session.emit(body))),
    } satisfies PiAgentSessionManagerShape;
  });

export const PiAgentSessionManagerLayer = Layer.effect(
  PiAgentSessionManager,
  Effect.gen(function* () {
    const pi = yield* PiAgent;
    const bus = yield* EventBus;
    return yield* makePiAgentSessionManager(pi, bus);
  }),
);
