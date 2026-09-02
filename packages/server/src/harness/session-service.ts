import type {
  AgentModelState,
  AgentResponse,
  CreateSessionOutput,
  CreateWorktreeInput,
  PromptInput,
  ReplaceQueueInput,
  SessionRef,
  SessionRuntimeSnapshot,
  SessionStatus,
  SessionSummary,
  SessionCapabilities,
  SessionWorkspace,
} from "@getpie/contract";
import type { PullRequestRef } from "@getpie/contract/pull-request";
import type { UIMessage } from "ai";
import { Context, Crypto, Effect, FileSystem, Layer, Semaphore } from "effect";

import { Paths } from "../config/paths";
import {
  ProjectNotFound,
  type SessionNotFound,
  type SessionRefNotFound,
  type StoreReadError,
  type StoreWriteError,
  UnsupportedPromptPart,
} from "../errors";
import { EventBus, type EventBusShape } from "../events/event-bus";
import type { GitFailure } from "../git/service";
import {
  WorktreeService,
  type GitWorktreeCreateResult,
  type GitWorktreeFailure,
} from "../git/worktree-service";
import { ProjectService } from "../project/service";
import type { Session } from "../types";
import type {
  AgentOperationError,
  CapabilityUnsupported,
  HarnessSessionNotFound,
  ResumeSessionError,
  TurnAlreadyRunning,
} from "./errors";
import { AgentRequestUnavailable, SessionClosed, SessionNotResumable } from "./errors";
import type { PiAgentShape } from "./pi/agent";
import { PiAgent } from "./pi/agent";
import type { PiAgentRuntime } from "./pi/runtime";
import type { SessionInfoResult } from "./pi/types";
import { inSession } from "./session-identity";
import type { PromptReceipt, RuntimePromptReceipt, UserInput } from "./session-io";
import type { PiAgentSessionManagerShape } from "./session-manager";
import { PiAgentSessionManager } from "./session-manager";
import {
  type PiAgentSessionRepositoryShape,
  makePiAgentSessionRepository,
} from "./session-repository";

const MAX_TITLE_CHARS = 60;
const deriveTitle = (parts: PromptInput["parts"]): string | undefined => {
  const text = parts.find((part) => part.type === "text")?.text.trim();
  if (!text) return undefined;
  const collapsed = text.replaceAll(/\s+/g, " ");
  return collapsed.length > MAX_TITLE_CHARS ? collapsed.slice(0, MAX_TITLE_CHARS) : collapsed;
};

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

type SessionWithCwd = Session & { readonly cwd: string };

const toSessionWorkspace = (metadata: SessionWithCwd): SessionWorkspace => ({
  cwd: metadata.cwd,
  ...(metadata.gitBranch !== undefined ? { gitBranch: metadata.gitBranch } : undefined),
});

const samePullRequestRef = (left: PullRequestRef, right: PullRequestRef): boolean =>
  left.host === right.host &&
  left.owner === right.owner &&
  left.repository === right.repository &&
  left.number === right.number;

export type CreatePiSessionInput = {
  readonly projectId: string;
  readonly cwd: string;
  readonly model?: { readonly provider: string; readonly modelId: string };
  readonly worktree?: CreateWorktreeInput;
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
  readonly workspaceFor: (
    ref: SessionRef,
  ) => Effect.Effect<SessionWorkspace, SessionNotFound | ProjectNotFound | StoreReadError>;
  readonly close: (ref: SessionRef) => Effect.Effect<void, SessionNotFound | StoreReadError>;
  readonly delete: (
    ref: SessionRef,
  ) => Effect.Effect<void, SessionNotFound | StoreReadError | StoreWriteError>;
  readonly rename: (
    ref: SessionRef,
    title: string,
  ) => Effect.Effect<void, SessionNotFound | StoreReadError | StoreWriteError>;
  readonly archive: (
    ref: SessionRef,
    archived: boolean,
  ) => Effect.Effect<void, SessionNotFound | StoreReadError | StoreWriteError>;
  readonly pullRequestRefsFor: (
    ref: SessionRef,
  ) => Effect.Effect<ReadonlyArray<PullRequestRef>, SessionNotFound | StoreReadError>;
  readonly rememberPullRequestRef: (
    ref: SessionRef,
    pullRequest: PullRequestRef,
  ) => Effect.Effect<void, SessionNotFound | StoreReadError | StoreWriteError>;
  readonly list: (
    projectId: string,
    archived: boolean,
  ) => Effect.Effect<ReadonlyArray<SessionSummary>, StoreReadError>;
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
  readonly resolveRef: (
    sessionId: string,
  ) => Effect.Effect<SessionRef, StoreReadError | SessionRefNotFound>;
};

export class PiAgentSessionService extends Context.Service<
  PiAgentSessionService,
  PiAgentSessionServiceShape
>()("PiAgentSessionService") {}

export const makePiAgentSessionService = (deps: {
  readonly manager: PiAgentSessionManagerShape;
  readonly pi: PiAgentShape;
  readonly repo: PiAgentSessionRepositoryShape;
  readonly bus: EventBusShape;
  readonly worktrees: {
    readonly create: (
      cwd: string,
      input?: { readonly base?: string },
    ) => Effect.Effect<GitWorktreeCreateResult, GitWorktreeFailure>;
    readonly remove: (path: string) => Effect.Effect<void, GitFailure>;
  };
  readonly newSessionId: Effect.Effect<string>;
  /** Backfill `metadata.cwd` for records created before cwd was persisted. */
  readonly projectPathFor: (
    projectId: string,
  ) => Effect.Effect<string, ProjectNotFound | StoreReadError>;
}): PiAgentSessionServiceShape => {
  const { manager, pi, repo, bus, worktrees, newSessionId, projectPathFor } = deps;

  const metadataMutationLocks = new Map<string, ReturnType<typeof Semaphore.makeUnsafe>>();
  const withMetadataMutation = <A, E, R>(
    ref: SessionRef,
    effect: Effect.Effect<A, E, R>,
  ): Effect.Effect<A, E, R> => {
    const key = `${ref.projectId}\0${ref.sessionId}`;
    const lock = metadataMutationLocks.get(key) ?? Semaphore.makeUnsafe(1);
    metadataMutationLocks.set(key, lock);
    return lock.withPermit(effect);
  };

  const readMetadata = (ref: SessionRef) => repo.read(ref.projectId, ref.sessionId);

  const modelStateFromMetadata = (metadata: Session): AgentModelState => ({
    ...(metadata.provider !== undefined ? { provider: metadata.provider } : undefined),
    ...(metadata.modelId !== undefined ? { modelId: metadata.modelId } : undefined),
  });

  const ensureCwd = (
    metadata: Session,
  ): Effect.Effect<SessionWithCwd, ProjectNotFound | StoreReadError | StoreWriteError> =>
    metadata.cwd !== undefined
      ? Effect.succeed(metadata as SessionWithCwd)
      : projectPathFor(metadata.projectId).pipe(
          Effect.flatMap((cwd) =>
            repo.write({ ...metadata, cwd }).pipe(Effect.map(() => ({ ...metadata, cwd }))),
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

  const readAndStampTitleFromFirstPrompt = (ref: SessionRef, parts: PromptInput["parts"]) =>
    withMetadataMutation(
      ref,
      readMetadata(ref).pipe(
        Effect.flatMap((metadata) => {
          if (metadata.title !== undefined) return Effect.succeed(metadata);
          const title = deriveTitle(parts);
          if (title === undefined) return Effect.succeed(metadata);
          const updated = { ...metadata, title };
          return repo.write(updated).pipe(
            Effect.andThen(bus.publish({ ref, type: "session.updated", title })),
            Effect.as(updated),
            Effect.catchTag("StoreWriteError", () => Effect.succeed(metadata)),
          );
        }),
      ),
    );

  const logLifecycle = (event: string, message: string, extra: Record<string, unknown> = {}) =>
    Effect.logInfo(message).pipe(Effect.annotateLogs({ event, ...extra }));

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

    workspaceFor: (ref) =>
      readMetadata(ref).pipe(
        Effect.flatMap((metadata) =>
          metadata.cwd !== undefined
            ? Effect.succeed(toSessionWorkspace(metadata as SessionWithCwd))
            : projectPathFor(metadata.projectId).pipe(
                Effect.map((cwd) => toSessionWorkspace({ ...metadata, cwd })),
              ),
        ),
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
      ).pipe(inSession(ref)),

    rename: (ref, title) =>
      withMetadataMutation(
        ref,
        readMetadata(ref).pipe(
          Effect.flatMap((metadata) =>
            metadata.title === title
              ? Effect.void
              : repo
                  .write({ ...metadata, title })
                  .pipe(Effect.andThen(bus.publish({ ref, type: "session.renamed", title }))),
          ),
        ),
      ).pipe(inSession(ref)),

    archive: (ref, archived) =>
      withMetadataMutation(
        ref,
        readMetadata(ref).pipe(
          Effect.flatMap((metadata) => {
            const changed = (metadata.archived ?? false) !== archived;
            const persist = changed ? repo.write({ ...metadata, archived }) : Effect.void;
            const close = archived
              ? manager.close(ref).pipe(Effect.andThen(bus.closeSession(ref, "session_closed")))
              : Effect.void;
            const publish = changed
              ? bus.publish({ ref, type: "session.archived", archived }).pipe(
                  Effect.andThen(
                    logLifecycle("session.archived", "session archive state changed", {
                      archived,
                    }),
                  ),
                )
              : Effect.void;
            return persist.pipe(Effect.andThen(close), Effect.andThen(publish));
          }),
        ),
      ).pipe(inSession(ref)),

    pullRequestRefsFor: (ref) =>
      readMetadata(ref).pipe(
        Effect.map((metadata) => metadata.pullRequestRefs ?? []),
        inSession(ref),
      ),

    rememberPullRequestRef: (ref, pullRequest) =>
      withMetadataMutation(
        ref,
        readMetadata(ref).pipe(
          Effect.flatMap((metadata) => {
            const existing = metadata.pullRequestRefs ?? [];
            if (existing.some((candidate) => samePullRequestRef(candidate, pullRequest))) {
              return Effect.void;
            }
            return repo.write({
              ...metadata,
              pullRequestRefs: [...existing, pullRequest],
            });
          }),
        ),
      ).pipe(inSession(ref)),

    list: (projectId, archived) =>
      repo.list(projectId).pipe(
        Effect.map((sessions) =>
          sessions.filter((metadata) => (metadata.archived ?? false) === archived),
        ),
        Effect.flatMap((sessions) =>
          Effect.forEach(sessions, (metadata) =>
            manager
              .liveStatus({
                projectId: metadata.projectId,
                sessionId: metadata.sessionId,
              })
              .pipe(
                Effect.map(
                  (status) =>
                    ({
                      projectId: metadata.projectId,
                      sessionId: metadata.sessionId,
                      archived: metadata.archived ?? false,
                      createdAt: metadata.createdAt,
                      historyAvailable: metadata.historyAvailable ?? true,
                      ...(metadata.title !== undefined ? { title: metadata.title } : undefined),
                      ...(metadata.updatedAt !== undefined
                        ? { updatedAt: metadata.updatedAt }
                        : undefined),
                      ...(status !== undefined ? { status } : undefined),
                    }) satisfies SessionSummary,
                ),
              ),
          ),
        ),
      ),

    getMessages: (ref) =>
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

    prompt: (input) =>
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

        // Idle: fire-and-forget so `submitted` still precedes `turn.started`.
        // Queued: await the harness — a failed follow-up must fail the RPC
        // (nothing was submitted, so there is no `rejected` to compensate).
        if (!queued) {
          const turnId = yield* newSessionId;
          yield* submitted();
          yield* deliverPrompt(input.ref, userInput).pipe(
            Effect.catch((error: unknown) =>
              reject(error instanceof Error ? error.message : String(error)),
            ),
            Effect.forkDetach,
          );
          return { turnId, started: true };
        }

        const receipt = yield* deliverPrompt(input.ref, userInput);
        if (receipt.started) yield* submitted();
        return { turnId: receipt.turnId, started: receipt.started };
      }).pipe(inSession(input.ref)),

    interrupt: (ref) =>
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

    respondToAgentRequest: (ref, requestId, response) =>
      readMetadata(ref).pipe(
        Effect.andThen(manager.peek(ref)),
        Effect.flatMap((runtime) =>
          runtime
            ? runtime.respondToAgentRequest(requestId, response)
            : Effect.fail(new AgentRequestUnavailable({ sessionId: ref.sessionId, requestId })),
        ),
        inSession(ref),
      ),

    getCapabilities: (ref) =>
      readMetadata(ref).pipe(
        Effect.andThen(manager.get(ref)),
        Effect.flatMap((runtime) => runtime.getCapabilities),
        inSession(ref),
      ),

    getModelState: (ref) =>
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

    setModel: (ref, model) =>
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

    getSessionInfo: (ref) =>
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

    getStatus: (ref) => manager.status(ref),
    getSnapshot: (ref) => manager.snapshot(ref),

    resolveRef: (sessionId) =>
      repo.findBySessionId(sessionId).pipe(
        Effect.map(
          (metadata): SessionRef => ({
            projectId: metadata.projectId,
            sessionId: metadata.sessionId,
          }),
        ),
      ),
  } satisfies PiAgentSessionServiceShape;
};

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
> = Layer.effect(
  PiAgentSessionService,
  Effect.gen(function* () {
    const manager = yield* PiAgentSessionManager;
    const pi = yield* PiAgent;
    const bus = yield* EventBus;
    const projects = yield* ProjectService;
    const worktrees = yield* WorktreeService;
    const paths = yield* Paths;
    const crypto = yield* Crypto.Crypto;
    const repo = yield* makePiAgentSessionRepository(paths.sessionsDir);
    return makePiAgentSessionService({
      manager,
      pi,
      repo,
      bus,
      worktrees,
      newSessionId: crypto.randomUUIDv4.pipe(
        Effect.catchTag("PlatformError", (cause) =>
          Effect.die(new Error("invariant: platform RNG failed minting a session id", { cause })),
        ),
      ),
      projectPathFor: (projectId) =>
        projects.findById(projectId).pipe(Effect.map((project) => project.path)),
    });
  }),
);
