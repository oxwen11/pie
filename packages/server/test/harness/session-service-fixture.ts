import path from "node:path";

import type { UIMessage } from "ai";
import { Context, Crypto, Effect, FileSystem, Layer, type Scope, Stream } from "effect";

import { ProjectNotFound, StoreWriteError } from "../../src/errors";
import { EventBus, type EventBusShape, makeEventBus } from "../../src/events/event-bus";
import type { GitFailure } from "../../src/git/service";
import {
  WorktreeService,
  type GitWorktreeCreateResult,
  type GitWorktreeFailure,
} from "../../src/git/worktree-service";
import { TurnAlreadyRunning, AgentUnavailable } from "../../src/harness/errors";
import { PiAgent, type PiAgentShape } from "../../src/harness/pi/agent";
import type { PiAgentRuntime } from "../../src/harness/pi/runtime";
import type { SessionInfoResult } from "../../src/harness/pi/types";
import type { UserInput } from "../../src/harness/session-io";
import {
  SessionMetadataLocks,
  SessionMetadataLocksLayer,
  type SessionMetadataLocksShape,
} from "../../src/harness/session-locks";
import {
  makePiAgentSessionManager,
  PiAgentSessionManager,
} from "../../src/harness/session-manager";
import { SessionMetadataLayer } from "../../src/harness/session-metadata";
import {
  type PiAgentSessionRepositoryShape,
  makePiAgentSessionRepository,
  PiAgentSessionRepository,
} from "../../src/harness/session-repository";
import {
  type PiAgentSessionServiceShape,
  PiAgentSessionService,
  PiAgentSessionServiceCoreLayer,
} from "../../src/harness/session-service";
import { ProjectService } from "../../src/project/service";

export type Spy = {
  open: Array<{ cwd: string; provider?: string; modelId?: string }>;
  resume: Array<{ sessionId: string; cwd: string | undefined }>;
  close: Array<string>;
  prompts: UserInput[];
};

export type Fixture = {
  readonly service: PiAgentSessionServiceShape;
  readonly repo: PiAgentSessionRepositoryShape;
  readonly bus: EventBusShape;
  readonly locks: SessionMetadataLocksShape;
  readonly spy: Spy;
  /**
   * A second service over the same storage and the same adapter — what a
   * server restart looks like from the session domain: the records survive,
   * nothing is live, and the spy keeps counting across both so "how many
   * processes has this session cost" stays answerable.
   */
  readonly restart: Effect.Effect<
    Fixture,
    never,
    Scope.Scope | FileSystem.FileSystem | Crypto.Crypto
  >;
};

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export type SessionServiceRunOpts = {
  unavailable?: string;
  history?: ReadonlyArray<UIMessage>;
  // The adapter reads history cold, off disk — no runtime involved.
  coldHistory?: ReadonlyArray<UIMessage>;
  // Feed the projection a turn: "open" leaves it in flight, "finished"
  // ends it (the runtime retains the completed buffer until the next turn).
  turn?: "open" | "finished";
  // The harness rejects every prompt (a turn is already running).
  promptFails?: boolean;
  // Whether a successful prompt opens a new turn. Queued follow-ups set this
  // false so the service can skip `session.prompt.submitted`.
  promptStarted?: boolean;
  // Optional close hook for exercising lifecycle contention.
  close?: (sessionId: string) => Promise<void>;
  prompt?: (
    input: UserInput,
  ) => Effect.Effect<{ readonly turnId: string; readonly started: boolean }>;
  failWrite?: boolean;
  worktreeCreate?: (
    cwd: string,
    input?: { readonly base?: string },
  ) => Effect.Effect<GitWorktreeCreateResult, GitWorktreeFailure>;
  worktreeRemove?: (path: string) => Effect.Effect<void, GitFailure>;
};

const testProjectService = ProjectService.of({
  list: () => Effect.succeed([]),
  findById: (projectId) =>
    projectId === "proj-a"
      ? Effect.succeed({
          id: projectId,
          name: "a",
          path: "/tmp/pie-app",
          createdAt: "2026-01-01T00:00:00.000Z",
        })
      : Effect.fail(new ProjectNotFound({ projectId })),
  findByPath: () => Effect.succeed(undefined),
  create: () => Effect.die("unused"),
  remove: () => Effect.die("unused"),
});

export const run = <A, E>(
  opts: SessionServiceRunOpts,
  program: (
    fixture: Fixture,
  ) => Effect.Effect<A, E, Scope.Scope | FileSystem.FileSystem | Crypto.Crypto>,
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const home = yield* fs.makeTempDirectoryScoped({ prefix: "pie-svc-" });
    const spy: Spy = { open: [], resume: [], close: [], prompts: [] };
    let opened = 0;
    const turnEvents = (sessionId: string) => {
      if (opts.turn === undefined) return Stream.empty;
      const drafts = [
        {
          sessionId,
          body: { type: "session.turn.started" as const, sessionId, turnId: "turn-1" },
        },
        ...(opts.turn === "finished"
          ? [
              {
                sessionId,
                body: {
                  type: "session.turn.ended" as const,
                  sessionId,
                  turnId: "turn-1",
                  outcome: "completed" as const,
                },
              },
            ]
          : []),
      ];
      // Stream.never keeps the drain alive so the projection stays up.
      return Stream.concat(Stream.fromArray(drafts), Stream.never);
    };
    // Sessions drain an empty native stream by default — enough to
    // exercise the orchestration without any live projection state.
    const makeSession = (sessionId: string): PiAgentRuntime => ({
      sessionId,
      events: turnEvents(sessionId),
      prompt: opts.promptFails
        ? (input) => {
            spy.prompts.push(input);
            return Effect.fail(new TurnAlreadyRunning({ sessionId }));
          }
        : (opts.prompt ??
          ((input) => {
            spy.prompts.push(input);
            return Effect.succeed({
              turnId: "turn-1",
              started: opts.promptStarted ?? true,
            });
          })),
      interrupt: Effect.void,
      replaceQueue: () => Effect.void,
      respondToAgentRequest: () => Effect.void,
      getCapabilities: Effect.succeed({
        supportsResume: true,
        supportsSteering: false,
        supportsPermissions: false,
      }),
      getMessages: Effect.succeed(opts.history ?? []),
      getModelState: Effect.succeed({}),
      setModel: (model) => Effect.succeed(model),
      close: Effect.sync(() => {
        spy.close.push(sessionId);
      }).pipe(
        Effect.andThen(
          opts.close === undefined
            ? Effect.void
            : Effect.promise(() => opts.close?.(sessionId) ?? Promise.resolve()),
        ),
      ),
    });
    const availability = Effect.sync(() =>
      opts.unavailable !== undefined
        ? { available: false as const, reason: opts.unavailable }
        : { available: true as const },
    );
    const whenAvailable = <BodyA, BodyE, BodyR>(body: Effect.Effect<BodyA, BodyE, BodyR>) =>
      Effect.gen(function* () {
        const result = yield* availability;
        if (!result.available) {
          return yield* Effect.fail(
            new AgentUnavailable({ reason: result.reason ?? "Unavailable" }),
          );
        }
        return yield* body;
      });
    const pi = {
      availability,
      create: (input) =>
        // Pi sees `cwd` and never a `SessionRef` — this line is the probe
        // for whether the identity reaches it anyway.
        whenAvailable(
          Effect.logDebug("pi creating").pipe(
            Effect.andThen(
              Effect.sync(() => {
                spy.open.push({
                  cwd: input.cwd,
                  ...(input.provider !== undefined ? { provider: input.provider } : undefined),
                  ...(input.modelId !== undefined ? { modelId: input.modelId } : undefined),
                });
                opened += 1;
                return makeSession(`native-${opened}`);
              }),
            ),
          ),
        ),
      resume: ({ sessionId, cwd }) =>
        whenAvailable(
          Effect.sync(() => {
            spy.resume.push({ sessionId, cwd });
            return makeSession(sessionId);
          }),
        ),
      ...(opts.coldHistory !== undefined
        ? { getMessages: () => Effect.succeed(opts.coldHistory ?? []) }
        : undefined),
      getSessionInfo: () => Effect.succeed<SessionInfoResult>({ _tag: "unsupported" }),
    } satisfies PiAgentShape;
    const build: Effect.Effect<
      Fixture,
      never,
      Scope.Scope | FileSystem.FileSystem | Crypto.Crypto
    > = Effect.gen(function* () {
      const crypto = yield* Crypto.Crypto;
      const bus = yield* makeEventBus();
      const manager = yield* makePiAgentSessionManager(pi, bus);
      const stored = yield* makePiAgentSessionRepository(path.join(home, "storage", "sessions"));
      const repo: PiAgentSessionRepositoryShape = opts.failWrite
        ? {
            ...stored,
            write: () =>
              Effect.fail(new StoreWriteError({ file: "sessions", cause: new Error("full") })),
          }
        : stored;
      const worktrees = WorktreeService.of({
        create:
          opts.worktreeCreate ??
          (() => Effect.die(new Error("unexpected worktreeCreate in unit test"))),
        remove:
          opts.worktreeRemove ??
          (() => Effect.die(new Error("unexpected worktreeRemove in unit test"))),
      });
      const locksLayer = SessionMetadataLocksLayer;
      const graph = Layer.mergeAll(PiAgentSessionServiceCoreLayer, locksLayer).pipe(
        Layer.provide(SessionMetadataLayer),
        Layer.provide(locksLayer),
        Layer.provide(Layer.succeed(PiAgentSessionRepository, repo)),
        Layer.provide(Layer.succeed(PiAgentSessionManager, manager)),
        Layer.provide(Layer.succeed(PiAgent, pi)),
        Layer.provide(Layer.succeed(EventBus, bus)),
        Layer.provide(Layer.succeed(ProjectService, testProjectService)),
        Layer.provide(Layer.succeed(WorktreeService, worktrees)),
        Layer.provide(Layer.succeed(Crypto.Crypto, crypto)),
      );
      const context = yield* Layer.build(graph);
      return {
        service: Context.get(context, PiAgentSessionService),
        repo,
        bus,
        locks: Context.get(context, SessionMetadataLocks),
        spy,
        restart: build,
      };
    });
    return yield* program(yield* build);
  });
