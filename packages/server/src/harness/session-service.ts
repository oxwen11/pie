import type {
  AgentModelState,
  AgentResponse,
  PromptInput,
  SessionRef,
  SessionRuntimeSnapshot,
  SessionStatus,
  SessionSummary,
  SessionWorkspace,
} from "@getpie/contract";
import type { SessionCapabilities } from "@getpie/contract";
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
import { GitService, type GitWorktreeCreateResult } from "../git/service";
import { ProjectRepository } from "../project/repository";
import type { Session } from "../types";
import type {
  AgentOperationError,
  HarnessSessionNotFound,
  ResumeSessionError,
  SessionClosed,
  TurnAlreadyRunning,
} from "./errors";
import { AgentRequestUnavailable, CapabilityUnsupported, SessionNotResumable } from "./errors";
import type { PiAgentShape } from "./pi/agent";
import { PiAgent } from "./pi/agent";
import type { PiAgentRuntime } from "./pi/runtime";
import type { SessionInfoResult } from "./pi/types";
import { inSession } from "./session-identity";
import type { PromptReceipt, UserInput } from "./session-io";
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
  const collapsed = text.replace(/\s+/g, " ");
  return collapsed.length > MAX_TITLE_CHARS ? collapsed.slice(0, MAX_TITLE_CHARS) : collapsed;
};

const toUserInput = (
  parts: PromptInput["parts"],
): Effect.Effect<UserInput, UnsupportedPromptPart> =>
  Effect.forEach(parts, (part) =>
    part.type === "file"
      ? Effect.fail(new UnsupportedPromptPart({ kind: "file" }))
      : Effect.succeed(part),
  ).pipe(Effect.map((userParts) => ({ parts: userParts })));

const toSessionWorkspace = (metadata: Session): SessionWorkspace => ({
  cwd: metadata.cwd!,
  ...(metadata.gitBranch !== undefined ? { gitBranch: metadata.gitBranch } : {}),
});

export type PiAgentSessionServiceShape = {
  readonly create: (
    projectId: string,
    cwd: string,
    model?: { readonly provider: string; readonly modelId: string },
    gitBranch?: string,
    pendingWorktree?: { readonly base?: string },
  ) => Effect.Effect<SessionRef, StoreWriteError>;
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
  ) => Effect.Effect<
    SessionWorkspace,
    SessionNotFound | ProjectNotFound | StoreReadError | StoreWriteError
  >;
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
    | CapabilityUnsupported
    | SessionClosed
    | AgentOperationError
  >;
  readonly prompt: (
    input: PromptInput,
  ) => Effect.Effect<
    PromptReceipt,
    | SessionNotFound
    | StoreReadError
    | UnsupportedPromptPart
    | ResumeSessionError
    | SessionClosed
    | TurnAlreadyRunning
    | AgentOperationError
  >;
  readonly interrupt: (
    ref: SessionRef,
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
    | CapabilityUnsupported
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
    | CapabilityUnsupported
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
  readonly git: {
    readonly worktreeCreate: (
      cwd: string,
      input?: { readonly branch?: string; readonly worktreeKey?: string; readonly base?: string },
    ) => Effect.Effect<GitWorktreeCreateResult, unknown>;
  };
  readonly newSessionId: Effect.Effect<string>;
  /** Backfill `metadata.cwd` for records created before cwd was persisted. */
  readonly projectPathFor: (
    projectId: string,
  ) => Effect.Effect<string, ProjectNotFound | StoreReadError>;
}): PiAgentSessionServiceShape => {
  const { manager, pi, repo, bus, git, newSessionId, projectPathFor } = deps;

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

  const sessionNeverOpened = (metadata: Session, ref: SessionRef): boolean =>
    metadata.agentSessionId === ref.sessionId;

  const ensureCwd = (
    metadata: Session,
  ): Effect.Effect<Session, ProjectNotFound | StoreReadError | StoreWriteError> =>
    metadata.cwd !== undefined
      ? Effect.succeed(metadata)
      : projectPathFor(metadata.projectId).pipe(
          Effect.flatMap((cwd) =>
            repo.write({ ...metadata, cwd }).pipe(Effect.map(() => ({ ...metadata, cwd }))),
          ),
        );

  const resolveWorkspaceForPrompt = (
    ref: SessionRef,
    metadata: Session,
  ): Effect.Effect<Session, ProjectNotFound | StoreReadError | StoreWriteError | unknown> =>
    metadata.pendingWorktree === undefined
      ? ensureCwd(metadata)
      : withMetadataMutation(
          ref,
          projectPathFor(metadata.projectId).pipe(
            Effect.flatMap((projectPath) => {
              const pendingWorktree = metadata.pendingWorktree!;
              return git
                .worktreeCreate(
                  projectPath,
                  pendingWorktree.base !== undefined ? { base: pendingWorktree.base } : undefined,
                )
                .pipe(
                  Effect.flatMap((worktree) => {
                    const updated: Session = {
                      ...metadata,
                      cwd: worktree.path,
                      gitBranch: worktree.branch,
                      pendingWorktree: undefined,
                    };
                    return repo.write(updated).pipe(Effect.as(updated));
                  }),
                );
            }),
          ),
        );

  const ensureRuntimeForPrompt = (
    ref: SessionRef,
    metadata: Session,
  ): Effect.Effect<
    PiAgentRuntime,
    ResumeSessionError | StoreReadError | StoreWriteError | AgentOperationError
  > =>
    Effect.gen(function* () {
      const existing = yield* manager.peek(ref);
      if (existing) return existing;

      const cwd = metadata.cwd;
      if (cwd === undefined) {
        return yield* Effect.die(
          new Error("invariant: prompt reached runtime acquisition without cwd"),
        );
      }

      if (sessionNeverOpened(metadata, ref)) {
        const runtime = yield* manager.open(
          {
            cwd,
            ...(metadata.provider !== undefined ? { provider: metadata.provider } : {}),
            ...(metadata.modelId !== undefined ? { modelId: metadata.modelId } : {}),
          },
          ref,
        );
        if (runtime.sessionId !== metadata.agentSessionId) {
          yield* repo.write({ ...metadata, agentSessionId: runtime.sessionId });
        }
        return runtime;
      }

      return yield* manager.ensureRuntime({ sessionId: metadata.agentSessionId, cwd }, ref);
    });

  const deliverPrompt = (
    ref: SessionRef,
    metadata: Session,
    userInput: UserInput,
  ): Effect.Effect<
    void,
    | ResumeSessionError
    | StoreReadError
    | StoreWriteError
    | AgentOperationError
    | ProjectNotFound
    | SessionClosed
    | TurnAlreadyRunning
    | unknown
  > =>
    Effect.gen(function* () {
      const resolved = yield* resolveWorkspaceForPrompt(ref, metadata);
      const runtime = yield* ensureRuntimeForPrompt(ref, resolved);
      yield* runtime.prompt(userInput).pipe(Effect.asVoid);
    });

  const readHistory = (
    ref: SessionRef,
    agentSessionId: string,
    cwd: string,
  ): Effect.Effect<
    ReadonlyArray<UIMessage>,
    ResumeSessionError | CapabilityUnsupported | SessionClosed | AgentOperationError
  > => {
    const cold = pi.getMessages;
    if (cold) return cold(agentSessionId, cwd);
    return manager
      .ensureRuntime({ sessionId: agentSessionId, cwd }, ref)
      .pipe(
        Effect.flatMap(
          (
            runtime,
          ): Effect.Effect<
            ReadonlyArray<UIMessage>,
            CapabilityUnsupported | SessionClosed | AgentOperationError
          > =>
            runtime.getMessages ??
            Effect.fail(new CapabilityUnsupported({ capability: "getMessages" })),
        ),
      );
  };

  const resolveAgentSessionId = (ref: SessionRef) =>
    readMetadata(ref).pipe(Effect.map((metadata) => metadata.agentSessionId));

  const runtimeInput = (agentSessionId: string, cwd: string) => ({
    sessionId: agentSessionId,
    cwd,
  });

  const withLiveRuntime = <A, E>(
    ref: SessionRef,
    agentSessionId: string,
    cwd: string,
    run: (
      runtime: PiAgentRuntime,
    ) => Effect.Effect<A, CapabilityUnsupported | SessionClosed | AgentOperationError | E>,
  ): Effect.Effect<
    A,
    ResumeSessionError | CapabilityUnsupported | SessionClosed | AgentOperationError | E
  > => manager.ensureRuntime(runtimeInput(agentSessionId, cwd), ref).pipe(Effect.flatMap(run));

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
    create: (projectId, cwd, model, gitBranch, pendingWorktree) =>
      newSessionId.pipe(
        Effect.flatMap((sessionId) => {
          const ref: SessionRef = { projectId, sessionId };
          const metadata: Session = {
            sessionId,
            projectId,
            agentSessionId: sessionId,
            createdAt: new Date().toISOString(),
            cwd,
            ...(gitBranch !== undefined ? { gitBranch } : {}),
            ...(model !== undefined ? { provider: model.provider, modelId: model.modelId } : {}),
            ...(pendingWorktree !== undefined ? { pendingWorktree } : {}),
            archived: false,
          };
          return repo.write(metadata).pipe(
            Effect.andThen(bus.publish({ ref, type: "session.created" })),
            Effect.andThen(
              logLifecycle("session.created", "session created", {
                cwd,
                agentSessionId: sessionId,
              }),
            ),
            Effect.as(ref),
            inSession(ref),
          );
        }),
      ),

    prepare: (ref) =>
      withMetadataMutation(
        ref,
        readMetadata(ref).pipe(Effect.flatMap((metadata) => ensureCwd(metadata))),
      ).pipe(
        Effect.flatMap((metadata) =>
          sessionNeverOpened(metadata, ref)
            ? Effect.succeed(toSessionWorkspace(metadata))
            : pi
                .getSessionInfo(metadata.agentSessionId, metadata.cwd!)
                .pipe(
                  Effect.flatMap((info) =>
                    info._tag === "missing"
                      ? Effect.fail(new SessionNotResumable({ sessionId: ref.sessionId }))
                      : Effect.succeed(toSessionWorkspace(metadata)),
                  ),
                ),
        ),
        inSession(ref),
      ),

    workspaceFor: (ref) =>
      readMetadata(ref).pipe(
        Effect.flatMap((metadata) => ensureCwd(metadata)),
        Effect.map(toSessionWorkspace),
        inSession(ref),
      ),

    close: (ref) =>
      resolveAgentSessionId(ref).pipe(
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
                      ...(metadata.title !== undefined ? { title: metadata.title } : {}),
                      ...(metadata.updatedAt !== undefined
                        ? { updatedAt: metadata.updatedAt }
                        : {}),
                      ...(status !== undefined ? { status } : {}),
                    }) satisfies SessionSummary,
                ),
              ),
          ),
        ),
      ),

    getMessages: (ref) =>
      readMetadata(ref).pipe(
        Effect.flatMap((metadata) =>
          ensureCwd(metadata).pipe(
            Effect.flatMap((resolved) =>
              readHistory(ref, resolved.agentSessionId, resolved.cwd!).pipe(
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
          ),
        ),
        inSession(ref),
      ),

    prompt: (input) =>
      Effect.gen(function* () {
        const userInput = yield* toUserInput(input.parts);
        const metadata = yield* readAndStampTitleFromFirstPrompt(input.ref, input.parts);
        const messageId = input.messageId ?? (yield* newSessionId);
        const turnId = yield* newSessionId;

        yield* manager.emit(input.ref, {
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

        yield* deliverPrompt(input.ref, metadata, userInput).pipe(
          Effect.catch((error: unknown) =>
            reject(error instanceof Error ? error.message : String(error)),
          ),
          Effect.forkDetach,
        );

        return { turnId };
      }).pipe(inSession(input.ref)),

    interrupt: (ref) =>
      readMetadata(ref).pipe(
        Effect.andThen(manager.peek(ref)),
        Effect.flatMap((runtime) => runtime?.interrupt ?? Effect.void),
        inSession(ref),
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
        Effect.flatMap((metadata) =>
          ensureCwd(metadata).pipe(
            Effect.flatMap((resolved) =>
              withLiveRuntime(
                ref,
                resolved.agentSessionId,
                resolved.cwd!,
                (runtime) =>
                  runtime.getModelState ??
                  Effect.fail(new CapabilityUnsupported({ capability: "getModelState" })),
              ),
            ),
          ),
        ),
        inSession(ref),
      ),

    setModel: (ref, model) =>
      readMetadata(ref).pipe(
        Effect.flatMap((metadata) =>
          ensureCwd(metadata).pipe(
            Effect.flatMap((resolved) =>
              withLiveRuntime(ref, resolved.agentSessionId, resolved.cwd!, (runtime) =>
                runtime.setModel
                  ? runtime.setModel(model)
                  : Effect.fail(new CapabilityUnsupported({ capability: "setModel" })),
              ),
            ),
          ),
        ),
        inSession(ref),
      ),

    getSessionInfo: (ref) =>
      readMetadata(ref).pipe(
        Effect.flatMap((metadata) =>
          ensureCwd(metadata).pipe(
            Effect.flatMap((resolved) => pi.getSessionInfo(resolved.agentSessionId, resolved.cwd!)),
          ),
        ),
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
  | ProjectRepository
  | Paths
  | GitService
  | Crypto.Crypto
  | FileSystem.FileSystem
> = Layer.effect(
  PiAgentSessionService,
  Effect.gen(function* () {
    const manager = yield* PiAgentSessionManager;
    const pi = yield* PiAgent;
    const bus = yield* EventBus;
    const projects = yield* ProjectRepository;
    const git = yield* GitService;
    const paths = yield* Paths;
    const crypto = yield* Crypto.Crypto;
    const repo = yield* makePiAgentSessionRepository(paths.sessionsDir);
    return makePiAgentSessionService({
      manager,
      pi,
      repo,
      bus,
      git,
      newSessionId: crypto.randomUUIDv4.pipe(
        Effect.catchTag("PlatformError", (cause) =>
          Effect.die(new Error("invariant: platform RNG failed minting a session id", { cause })),
        ),
      ),
      projectPathFor: (projectId) =>
        projects.list().pipe(
          Effect.flatMap((list) => {
            const found = list.find((project) => project.id === projectId);
            return found === undefined
              ? Effect.fail(new ProjectNotFound({ projectId }))
              : Effect.succeed(found.path);
          }),
        ),
    });
  }),
);
