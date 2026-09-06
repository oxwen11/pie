import type {
  AgentModelState,
  AgentResponse,
  CreateSessionOutput,
  CreateWorktreeInput,
  PromptInput,
  ReplaceQueueInput,
  SessionCapabilities,
  SessionRef,
  SessionRuntimeSnapshot,
  SessionStatus,
  SessionWorkspace,
} from "@getpie/contract";
import type { UIMessage } from "ai";
import { Context, Crypto, Effect, FileSystem, Layer } from "effect";

import { Paths } from "../config/paths";
import {
  type ProjectNotFound,
  type SessionNotFound,
  type SessionRefNotFound,
  type StoreReadError,
  type StoreWriteError,
  UnsupportedPromptPart,
} from "../errors";
import { EventBus } from "../events/event-bus";
import { WorktreeService, type GitWorktreeFailure } from "../git/worktree-service";
import { ProjectService } from "../project/service";
import type { Session } from "../types";
import {
  AgentRequestUnavailable,
  type AgentOperationError,
  type CapabilityUnsupported,
  type HarnessSessionNotFound,
  type ResumeSessionError,
  SessionClosed,
  SessionNotResumable,
  type TurnAlreadyRunning,
} from "./errors";
import { PiAgent } from "./pi/agent";
import type { PiAgentRuntime } from "./pi/runtime";
import type { SessionInfoResult } from "./pi/types";
import { inSession } from "./session-identity";
import type { PromptReceipt, RuntimePromptReceipt, UserInput } from "./session-io";
import { SessionMetadataLocks, SessionMetadataLocksLayer } from "./session-locks";
import { PiAgentSessionManager } from "./session-manager";
import {
  logLifecycle,
  modelStateFromMetadata,
  SessionMetadata,
  SessionMetadataLayer,
  type SessionMetadataShape,
  type SessionWithCwd,
  toSessionWorkspace,
} from "./session-metadata";
import { PiAgentSessionRepository, PiAgentSessionRepositoryLayer } from "./session-repository";

export type CreatePiSessionInput = {
  readonly projectId: string;
  readonly cwd: string;
  readonly model?: { readonly provider: string; readonly modelId: string };
  readonly worktree?: CreateWorktreeInput;
  /** Display title written at create so the sidebar can name the row before the first prompt. */
  readonly title?: string;
};

export type PiAgentSessionServiceShape = {
  readonly create: (
    input: CreatePiSessionInput,
  ) => Effect.Effect<CreateSessionOutput, StoreWriteError | GitWorktreeFailure>;
  readonly prepare: (
    ref: SessionRef,
  ) => Effect.Effect<
    SessionWorkspace,
    | SessionNotFound
    | ProjectNotFound
    | StoreReadError
    | StoreWriteError
    | SessionNotResumable
    | AgentOperationError
  >;
  readonly close: (ref: SessionRef) => Effect.Effect<void, SessionNotFound | StoreReadError>;
  readonly delete: (
    ref: SessionRef,
  ) => Effect.Effect<void, SessionNotFound | StoreReadError | StoreWriteError>;
  readonly resolveRef: (
    sessionId: string,
  ) => Effect.Effect<SessionRef, StoreReadError | SessionRefNotFound>;
  readonly getMessages: (
    ref: SessionRef,
  ) => Effect.Effect<
    ReadonlyArray<UIMessage>,
    | SessionNotFound
    | ProjectNotFound
    | StoreReadError
    | StoreWriteError
    | ResumeSessionError
    | SessionClosed
    | AgentOperationError
  >;
  readonly prompt: (
    input: PromptInput,
  ) => Effect.Effect<
    PromptReceipt,
    | SessionNotFound
    | StoreReadError
    | StoreWriteError
    | ProjectNotFound
    | UnsupportedPromptPart
    | ResumeSessionError
    | SessionClosed
    | TurnAlreadyRunning
    | AgentOperationError
  >;
  readonly interrupt: (
    ref: SessionRef,
  ) => Effect.Effect<void, SessionNotFound | StoreReadError | SessionClosed | AgentOperationError>;
  readonly replaceQueue: (
    input: ReplaceQueueInput,
  ) => Effect.Effect<void, SessionNotFound | StoreReadError | SessionClosed | AgentOperationError>;
  readonly respondToAgentRequest: (
    ref: SessionRef,
    requestId: string,
    response: AgentResponse,
  ) => Effect.Effect<
    void,
    SessionNotFound | StoreReadError | AgentRequestUnavailable | AgentOperationError
  >;
  readonly getCapabilities: (
    ref: SessionRef,
  ) => Effect.Effect<
    SessionCapabilities,
    | SessionNotFound
    | StoreReadError
    | HarnessSessionNotFound
    | CapabilityUnsupported
    | AgentOperationError
  >;
  readonly getModelState: (
    ref: SessionRef,
  ) => Effect.Effect<
    AgentModelState,
    | SessionNotFound
    | ProjectNotFound
    | StoreReadError
    | StoreWriteError
    | ResumeSessionError
    | SessionClosed
    | AgentOperationError
  >;
  readonly setModel: (
    ref: SessionRef,
    model: { readonly provider: string; readonly modelId: string },
  ) => Effect.Effect<
    AgentModelState,
    | SessionNotFound
    | ProjectNotFound
    | StoreReadError
    | StoreWriteError
    | ResumeSessionError
    | SessionClosed
    | AgentOperationError
  >;
  readonly getSessionInfo: (
    ref: SessionRef,
  ) => Effect.Effect<
    SessionInfoResult,
    SessionNotFound | ProjectNotFound | StoreReadError | StoreWriteError | AgentOperationError
  >;
  readonly getStatus: (ref: SessionRef) => Effect.Effect<SessionStatus>;
  readonly getSnapshot: (ref: SessionRef) => Effect.Effect<SessionRuntimeSnapshot>;
} & Pick<
  SessionMetadataShape,
  "workspaceFor" | "rename" | "archive" | "pullRequestRefsFor" | "rememberPullRequestRef" | "list"
>;

export class PiAgentSessionService extends Context.Service<
  PiAgentSessionService,
  PiAgentSessionServiceShape
>()("PiAgentSessionService") {}

const toUserInput = (
  parts: PromptInput["parts"],
  delivery: PromptInput["delivery"],
): Effect.Effect<UserInput, UnsupportedPromptPart> =>
  Effect.forEach(parts, (part) =>
    part.type === "file"
      ? Effect.fail(new UnsupportedPromptPart({ kind: "file" }))
      : Effect.succeed(part),
  ).pipe(
    Effect.map((userParts) => {
      const userInput: UserInput = { parts: userParts };
      if (delivery === undefined) return userInput;
      return { ...userInput, delivery };
    }),
  );

/**
 * Session orchestration with repository, locks, and metadata still in `R`.
 * Tests `Layer.succeed` those three (and the Pi collaborators) onto this.
 */
export const PiAgentSessionServiceCoreLayer: Layer.Layer<
  PiAgentSessionService,
  never,
  | PiAgentSessionManager
  | PiAgent
  | PiAgentSessionRepository
  | EventBus
  | WorktreeService
  | Crypto.Crypto
  | SessionMetadata
  | SessionMetadataLocks
> = Layer.effect(
  PiAgentSessionService,
  Effect.gen(function* () {
    const manager = yield* PiAgentSessionManager;
    const pi = yield* PiAgent;
    const repo = yield* PiAgentSessionRepository;
    const bus = yield* EventBus;
    const worktrees = yield* WorktreeService;
    const crypto = yield* Crypto.Crypto;
    const sessionMetadata = yield* SessionMetadata;
    const locks = yield* SessionMetadataLocks;
    const { readMetadata, ensureCwd, readAndStampTitleFromFirstPrompt } = sessionMetadata;
    const withMetadataMutation = locks.withLock;
    const newSessionId = crypto.randomUUIDv4.pipe(
      Effect.catchTag("PlatformError", (cause) =>
        Effect.die(new Error("invariant: platform RNG failed minting a session id", { cause })),
      ),
    );

    const ensureRuntimeForPrompt = (
      ref: SessionRef,
      metadata: SessionWithCwd,
    ): Effect.Effect<
      PiAgentRuntime,
      ResumeSessionError | StoreReadError | StoreWriteError | AgentOperationError
    > =>
      Effect.gen(function* () {
        const existing = yield* manager.peek(ref);
        if (existing) return existing;

        if (metadata.agentSessionId === undefined) {
          const runtime = yield* manager.open(
            {
              cwd: metadata.cwd,
              ...(metadata.provider !== undefined ? { provider: metadata.provider } : undefined),
              ...(metadata.modelId !== undefined ? { modelId: metadata.modelId } : undefined),
            },
            ref,
          );
          yield* repo.write({ ...metadata, agentSessionId: runtime.sessionId });
          return runtime;
        }

        return yield* manager.ensureRuntime(
          { sessionId: metadata.agentSessionId, cwd: metadata.cwd },
          ref,
        );
      });

    const deliverPrompt = (
      ref: SessionRef,
      userInput: UserInput,
    ): Effect.Effect<
      RuntimePromptReceipt,
      | ResumeSessionError
      | StoreReadError
      | StoreWriteError
      | AgentOperationError
      | ProjectNotFound
      | SessionNotFound
      | SessionClosed
      | TurnAlreadyRunning
    > =>
      Effect.gen(function* () {
        const resolved = yield* readMetadata(ref).pipe(Effect.flatMap(ensureCwd));
        const runtime = yield* ensureRuntimeForPrompt(ref, resolved);
        return yield* runtime.prompt(userInput);
      });

    const readHistory = (
      ref: SessionRef,
      agentSessionId: string,
      cwd: string,
    ): Effect.Effect<
      ReadonlyArray<UIMessage>,
      ResumeSessionError | SessionClosed | AgentOperationError
    > => {
      const cold = pi.getMessages;
      if (cold) return cold(agentSessionId, cwd);
      return manager
        .ensureRuntime({ sessionId: agentSessionId, cwd }, ref)
        .pipe(Effect.flatMap((runtime) => runtime.getMessages));
    };

    const runtimeInput = (agentSessionId: string, cwd: string) => ({
      sessionId: agentSessionId,
      cwd,
    });

    const withLiveRuntime = <A, E>(
      ref: SessionRef,
      agentSessionId: string,
      cwd: string,
      run: (runtime: PiAgentRuntime) => Effect.Effect<A, SessionClosed | AgentOperationError | E>,
    ): Effect.Effect<A, ResumeSessionError | SessionClosed | AgentOperationError | E> =>
      manager.ensureRuntime(runtimeInput(agentSessionId, cwd), ref).pipe(Effect.flatMap(run));

    return {
      create: (input) =>
        newSessionId.pipe(
          Effect.flatMap((sessionId) => {
            const ref: SessionRef = { projectId: input.projectId, sessionId };
            const materializeWorkspace: Effect.Effect<SessionWorkspace, GitWorktreeFailure> =
              input.worktree === undefined
                ? Effect.succeed({ cwd: input.cwd })
                : worktrees
                    .create(
                      input.cwd,
                      input.worktree.base !== undefined ? { base: input.worktree.base } : undefined,
                    )
                    .pipe(
                      Effect.map((created) => ({
                        cwd: created.path,
                        gitBranch: created.branch,
                      })),
                    );
            return materializeWorkspace.pipe(
              Effect.flatMap((sessionWorkspace) => {
                const metadata: Session = {
                  sessionId,
                  projectId: input.projectId,
                  createdAt: new Date().toISOString(),
                  cwd: sessionWorkspace.cwd,
                  ...(sessionWorkspace.gitBranch !== undefined
                    ? { gitBranch: sessionWorkspace.gitBranch }
                    : undefined),
                  ...(input.model !== undefined
                    ? { provider: input.model.provider, modelId: input.model.modelId }
                    : undefined),
                  ...(input.title !== undefined ? { title: input.title } : undefined),
                  archived: false,
                };
                return repo.write(metadata).pipe(
                  Effect.tapError(() =>
                    sessionWorkspace.gitBranch === undefined
                      ? Effect.void
                      : worktrees.remove(sessionWorkspace.cwd).pipe(Effect.ignore),
                  ),
                  Effect.andThen(bus.publish({ ref, type: "session.created" })),
                  Effect.andThen(
                    input.title === undefined
                      ? Effect.void
                      : bus.publish({ ref, type: "session.updated", title: input.title }),
                  ),
                  Effect.andThen(
                    logLifecycle("session.created", "session created", {
                      cwd: sessionWorkspace.cwd,
                    }),
                  ),
                  Effect.as({ ref, workspace: sessionWorkspace }),
                );
              }),
              inSession(ref),
            );
          }),
        ),

      prepare: (ref) =>
        withMetadataMutation(
          ref,
          readMetadata(ref).pipe(Effect.flatMap((metadata) => ensureCwd(metadata))),
        ).pipe(
          Effect.flatMap((metadata) => {
            if (metadata.agentSessionId === undefined) {
              return Effect.succeed(toSessionWorkspace(metadata));
            }
            return pi
              .getSessionInfo(metadata.agentSessionId, metadata.cwd)
              .pipe(
                Effect.flatMap((info) =>
                  info._tag === "missing"
                    ? Effect.fail(new SessionNotResumable({ sessionId: ref.sessionId }))
                    : Effect.succeed(toSessionWorkspace(metadata)),
                ),
              );
          }),
          inSession(ref),
        ),

      close: (ref) =>
        readMetadata(ref).pipe(
          Effect.andThen(manager.close(ref)),
          Effect.andThen(bus.closeSession(ref, "session_closed")),
          Effect.andThen(bus.publish({ ref, type: "session.closed" })),
          Effect.andThen(logLifecycle("session.closed", "session closed")),
          inSession(ref),
        ),

      delete: (ref) =>
        withMetadataMutation(
          ref,
          readMetadata(ref).pipe(
            Effect.andThen(manager.close(ref)),
            Effect.andThen(bus.closeSession(ref, "session_deleted")),
            Effect.andThen(repo.remove(ref.projectId, ref.sessionId)),
            Effect.andThen(bus.publish({ ref, type: "session.deleted" })),
            Effect.andThen(logLifecycle("session.deleted", "session deleted")),
          ),
        ).pipe(Effect.ensuring(locks.release(ref)), inSession(ref)),

      resolveRef: (sessionId) =>
        repo.findBySessionId(sessionId).pipe(
          Effect.map(
            (metadata): SessionRef => ({
              projectId: metadata.projectId,
              sessionId: metadata.sessionId,
            }),
          ),
        ),

      getMessages: (ref: SessionRef) =>
        readMetadata(ref).pipe(
          Effect.flatMap((metadata) => {
            if (metadata.agentSessionId === undefined) {
              return Effect.succeed<ReadonlyArray<UIMessage>>([]);
            }
            const agentSessionId = metadata.agentSessionId;
            return ensureCwd(metadata).pipe(
              Effect.flatMap((resolved) =>
                readHistory(ref, agentSessionId, resolved.cwd).pipe(
                  Effect.flatMap((messages) =>
                    manager.status(ref).pipe(
                      Effect.map((status) => {
                        if (status.activeTurnId === undefined) return messages;
                        for (let index = messages.length - 1; index >= 0; index -= 1) {
                          if (messages[index]?.role === "user") return messages.slice(0, index);
                        }
                        return messages;
                      }),
                    ),
                  ),
                ),
              ),
            );
          }),
          inSession(ref),
        ),

      prompt: (input: PromptInput) =>
        Effect.gen(function* () {
          const queued = input.delivery !== undefined;
          const userInput = yield* toUserInput(input.parts, input.delivery);
          yield* readAndStampTitleFromFirstPrompt(input.ref, input.parts);
          const messageId = input.messageId ?? (yield* newSessionId);

          const submitted = () =>
            manager.emit(input.ref, {
              type: "session.prompt.submitted",
              messageId,
              parts: input.parts,
            });

          const reject = (reason: string) =>
            manager.emit(input.ref, {
              type: "session.prompt.rejected",
              messageId,
              reason,
            });

          // Idle prompts publish the optimistic boundary first, then return the
          // runtime's real admission receipt. A failure emits the compensating
          // rejection for every subscriber and still fails the initiating RPC.
          if (!queued) {
            yield* submitted();
            return yield* deliverPrompt(input.ref, userInput).pipe(
              Effect.tapError((error) =>
                reject(error instanceof Error ? error.message : String(error)),
              ),
            );
          }

          const receipt = yield* deliverPrompt(input.ref, userInput);
          if (receipt.started) yield* submitted();
          return receipt;
        }).pipe(inSession(input.ref)),

      interrupt: (ref: SessionRef) =>
        readMetadata(ref).pipe(
          Effect.andThen(manager.peek(ref)),
          Effect.flatMap((runtime) => runtime?.interrupt ?? Effect.void),
          inSession(ref),
        ),

      replaceQueue: (input) =>
        readMetadata(input.ref).pipe(
          Effect.andThen(manager.peek(input.ref)),
          Effect.flatMap((runtime) => {
            if (runtime) {
              return runtime.replaceQueue({
                steering: input.steering,
                followUp: input.followUp,
              });
            }
            if (input.steering.length === 0 && input.followUp.length === 0) return Effect.void;
            return Effect.fail(new SessionClosed({ sessionId: input.ref.sessionId }));
          }),
          inSession(input.ref),
        ),

      respondToAgentRequest: (ref: SessionRef, requestId: string, response: AgentResponse) =>
        readMetadata(ref).pipe(
          Effect.andThen(manager.peek(ref)),
          Effect.flatMap((runtime) =>
            runtime
              ? runtime.respondToAgentRequest(requestId, response)
              : Effect.fail(new AgentRequestUnavailable({ sessionId: ref.sessionId, requestId })),
          ),
          inSession(ref),
        ),

      getCapabilities: (ref: SessionRef) =>
        readMetadata(ref).pipe(
          Effect.andThen(manager.get(ref)),
          Effect.flatMap((runtime) => runtime.getCapabilities),
          inSession(ref),
        ),

      getModelState: (ref: SessionRef) =>
        readMetadata(ref).pipe(
          Effect.flatMap((metadata) => {
            if (metadata.agentSessionId === undefined) {
              return Effect.succeed(modelStateFromMetadata(metadata));
            }
            const agentSessionId = metadata.agentSessionId;
            return ensureCwd(metadata).pipe(
              Effect.flatMap((resolved) =>
                withLiveRuntime(
                  ref,
                  agentSessionId,
                  resolved.cwd,
                  (runtime) => runtime.getModelState,
                ),
              ),
            );
          }),
          inSession(ref),
        ),

      setModel: (ref: SessionRef, model: { readonly provider: string; readonly modelId: string }) =>
        withMetadataMutation(
          ref,
          readMetadata(ref).pipe(
            Effect.flatMap((metadata) => {
              const persistModel = repo.write({
                ...metadata,
                provider: model.provider,
                modelId: model.modelId,
              });
              if (metadata.agentSessionId === undefined) {
                return persistModel.pipe(Effect.as(model satisfies AgentModelState));
              }
              const agentSessionId = metadata.agentSessionId;
              return ensureCwd(metadata).pipe(
                Effect.flatMap((resolved) =>
                  persistModel.pipe(
                    Effect.andThen(
                      withLiveRuntime(ref, agentSessionId, resolved.cwd, (runtime) =>
                        runtime.setModel(model),
                      ),
                    ),
                  ),
                ),
              );
            }),
          ),
        ).pipe(inSession(ref)),

      getSessionInfo: (ref: SessionRef) =>
        readMetadata(ref).pipe(
          Effect.flatMap((metadata) => {
            if (metadata.agentSessionId === undefined) {
              return Effect.succeed<SessionInfoResult>({ _tag: "unsupported" });
            }
            const agentSessionId = metadata.agentSessionId;
            return ensureCwd(metadata).pipe(
              Effect.flatMap((resolved) => pi.getSessionInfo(agentSessionId, resolved.cwd)),
            );
          }),
          inSession(ref),
        ),

      getStatus: (ref: SessionRef) => manager.status(ref),
      getSnapshot: (ref: SessionRef) => manager.snapshot(ref),

      workspaceFor: sessionMetadata.workspaceFor,
      rename: sessionMetadata.rename,
      archive: sessionMetadata.archive,
      pullRequestRefsFor: sessionMetadata.pullRequestRefsFor,
      rememberPullRequestRef: sessionMetadata.rememberPullRequestRef,
      list: sessionMetadata.list,
    } satisfies PiAgentSessionServiceShape;
  }),
);

/**
 * Production face. Provides metadata, per-ref locks, and the session
 * repository. `rpc/runtime.ts` still supplies manager, Pi, EventBus,
 * ProjectService, Paths, WorktreeService, and platform Crypto/FS.
 */
export const PiAgentSessionServiceLayer: Layer.Layer<
  PiAgentSessionService,
  never,
  | PiAgentSessionManager
  | PiAgent
  | EventBus
  | ProjectService
  | Paths
  | WorktreeService
  | Crypto.Crypto
  | FileSystem.FileSystem
> = PiAgentSessionServiceCoreLayer.pipe(
  Layer.provide(SessionMetadataLayer),
  Layer.provide(SessionMetadataLocksLayer),
  Layer.provide(PiAgentSessionRepositoryLayer),
);
