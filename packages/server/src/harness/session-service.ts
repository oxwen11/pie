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
  PieUIMessage,
  SessionWorkspace,
} from "@getpie/contract";
import {
  normalizePullRequestRef,
  pullRequestKey,
  type PullRequestLinkSource,
  type PullRequestRef,
  type SessionPullRequestLink,
} from "@getpie/contract/pull-request";
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
import { GitService } from "../git/service";
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
import { persistDefaultPiModel } from "./pi/resolve-default-model";
import type { PiAgentRuntime } from "./pi/runtime";
import { PiSessionTools } from "./pi/session-tools";
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

export type SessionPullRequestContext = {
  readonly links: ReadonlyArray<SessionPullRequestLink>;
  readonly generation: number;
  readonly cwd: string | undefined;
  readonly branch: string | undefined;
  readonly archived: boolean;
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
    ReadonlyArray<PieUIMessage>,
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
  readonly pullRequestsFor: (
    ref: SessionRef,
  ) => Effect.Effect<ReadonlyArray<SessionPullRequestLink>, SessionNotFound | StoreReadError>;
  readonly registerPullRequest: (
    ref: SessionRef,
    pullRequest: PullRequestRef,
    source?: PullRequestLinkSource,
    restore?: boolean,
  ) => Effect.Effect<
    "linked" | "exists" | "excluded",
    SessionNotFound | StoreReadError | StoreWriteError
  >;
  readonly excludePullRequest: (
    ref: SessionRef,
    pullRequest: PullRequestRef,
  ) => Effect.Effect<void, SessionNotFound | StoreReadError | StoreWriteError>;
  readonly pullRequestContextFor: (
    ref: SessionRef,
  ) => Effect.Effect<SessionPullRequestContext, SessionNotFound | StoreReadError>;
  /** Compare generation and branch/archive context, then merge only PR fields. */
  readonly mergePullRequests: (
    ref: SessionRef,
    expected: SessionPullRequestContext,
    links: ReadonlyArray<SessionPullRequestLink>,
  ) => Effect.Effect<boolean, SessionNotFound | StoreReadError | StoreWriteError>;
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
  | GitService
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
    const git = yield* GitService;
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

    const resolveWorkspace = (ref: SessionRef) =>
      withMetadataMutation(ref, readMetadata(ref).pipe(Effect.flatMap(ensureCwd)));

    const readBranch = (cwd: string) =>
      git.branch(cwd).pipe(
        Effect.map((branch) =>
          branch.kind === "repository" ? (branch.current ?? undefined) : undefined,
        ),
        Effect.catch(() => Effect.succeed(undefined)),
      );
    const generations = new Map<string, number>();
    const sessionKey = (ref: SessionRef) => `${ref.projectId}\0${ref.sessionId}`;
    const generation = (ref: SessionRef) => generations.get(sessionKey(ref)) ?? 0;
    const invalidate = (ref: SessionRef) =>
      Effect.sync(() => generations.set(sessionKey(ref), generation(ref) + 1));
    const linksFor = (metadata: Session): ReadonlyArray<SessionPullRequestLink> =>
      metadata.pullRequests ?? [];
    const observedBranch = (metadata: Session) =>
      metadata.worktree !== undefined && metadata.cwd !== undefined
        ? readBranch(metadata.cwd)
        : Effect.succeed(metadata.gitBranch);
    const changedPullRequests = (ref: SessionRef) =>
      bus.publish({ ref, type: "session.pull-requests.updated" });
    const normalizedRef = (pullRequest: PullRequestRef) => normalizePullRequestRef(pullRequest);
    const registerPullRequest: PiAgentSessionServiceShape["registerPullRequest"] = (
      ref,
      rawRef,
      source = "agent",
      restore = false,
    ) =>
      withMetadataMutation(
        ref,
        Effect.gen(function* () {
          const pullRequest = normalizedRef(rawRef);
          const metadata = yield* readMetadata(ref);
          const links = linksFor(metadata);
          const existing = links.find(
            (link) => pullRequestKey(link.ref) === pullRequestKey(pullRequest),
          );
          if (existing && !(existing.excluded && restore))
            return existing.excluded ? "excluded" : "exists";
          const next = existing
            ? links.map((link) => (link === existing ? { ...link, excluded: false } : link))
            : [
                ...links,
                {
                  ref: pullRequest,
                  source,
                  linkedAt: new Date().toISOString(),
                  excluded: false,
                  snapshot: null,
                  stack: null,
                  stackCheckedAt: null,
                },
              ];
          yield* repo.write({ ...metadata, pullRequests: next });
          yield* invalidate(ref);
          yield* changedPullRequests(ref);
          return "linked" as const;
        }),
      );
    const excludePullRequest: PiAgentSessionServiceShape["excludePullRequest"] = (ref, rawRef) =>
      withMetadataMutation(
        ref,
        Effect.gen(function* () {
          const pullRequest = normalizedRef(rawRef);
          const metadata = yield* readMetadata(ref);
          const links = linksFor(metadata);
          const existing = links.find(
            (link) => pullRequestKey(link.ref) === pullRequestKey(pullRequest),
          );
          if (existing?.excluded) return;
          const next = existing
            ? links.map((link) => (link === existing ? { ...link, excluded: true } : link))
            : [
                ...links,
                {
                  ref: pullRequest,
                  source: "agent" as const,
                  linkedAt: new Date().toISOString(),
                  excluded: true,
                  snapshot: null,
                  stack: null,
                  stackCheckedAt: null,
                },
              ];
          yield* repo.write({ ...metadata, pullRequests: next });
          yield* invalidate(ref);
          yield* changedPullRequests(ref);
        }),
      );
    const withSessionTools = (ref: SessionRef) =>
      Effect.provideService(PiSessionTools, {
        list: readMetadata(ref).pipe(Effect.map(linksFor)),
        register: (pullRequest, restore) => registerPullRequest(ref, pullRequest, "agent", restore),
        exclude: (pullRequest) => excludePullRequest(ref, pullRequest),
      });

    const ensureRuntimeForPrompt = (
      ref: SessionRef,
      metadata: SessionWithCwd,
    ): Effect.Effect<
      PiAgentRuntime,
      ResumeSessionError | SessionNotFound | StoreReadError | StoreWriteError | AgentOperationError
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
          // The spawn above can take seconds; archive/rename may mutate the
          // metadata meanwhile. Re-read under the per-session lock so the
          // agentSessionId write does not resurrect stale fields (e.g. an
          // archived flag written while the spawn was in flight).
          yield* withMetadataMutation(
            ref,
            readMetadata(ref).pipe(
              Effect.flatMap((fresh) =>
                fresh.agentSessionId === undefined
                  ? repo.write({ ...fresh, agentSessionId: runtime.sessionId })
                  : Effect.void,
              ),
            ),
          );
          return runtime;
        }

        return yield* manager.ensureRuntime(
          { sessionId: metadata.agentSessionId, cwd: metadata.cwd },
          ref,
        );
      }).pipe(withSessionTools(ref));

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
        const resolved = yield* resolveWorkspace(ref);
        const runtime = yield* ensureRuntimeForPrompt(ref, resolved);
        return yield* runtime.prompt(userInput);
      });

    const readHistory = (
      ref: SessionRef,
      agentSessionId: string,
      cwd: string,
    ): Effect.Effect<
      ReadonlyArray<PieUIMessage>,
      ResumeSessionError | SessionClosed | AgentOperationError
    > => {
      const cold = pi.getMessages;
      if (cold) return cold(agentSessionId, cwd);
      return manager.ensureRuntime({ sessionId: agentSessionId, cwd }, ref).pipe(
        withSessionTools(ref),
        Effect.flatMap((runtime) => runtime.getMessages),
      );
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
      manager
        .ensureRuntime(runtimeInput(agentSessionId, cwd), ref)
        .pipe(withSessionTools(ref), Effect.flatMap(run));

    return {
      create: (input) =>
        newSessionId.pipe(
          Effect.flatMap((sessionId) => {
            const ref: SessionRef = { projectId: input.projectId, sessionId };
            const materializeWorkspace: Effect.Effect<
              { readonly workspace: SessionWorkspace; readonly gitBranch?: string },
              GitWorktreeFailure
            > =
              input.worktree === undefined
                ? readBranch(input.cwd).pipe(
                    Effect.map((gitBranch) => ({
                      workspace: { cwd: input.cwd },
                      ...(gitBranch !== undefined ? { gitBranch } : undefined),
                    })),
                  )
                : worktrees
                    .create(
                      input.cwd,
                      input.worktree.base !== undefined ? { base: input.worktree.base } : undefined,
                    )
                    .pipe(
                      Effect.map((created) => ({
                        workspace: {
                          cwd: created.path,
                          worktree: { branch: created.branch },
                        },
                      })),
                    );
            return materializeWorkspace.pipe(
              Effect.flatMap((createdWorkspace) => {
                const sessionWorkspace = createdWorkspace.workspace;
                const metadata: Session = {
                  sessionId,
                  projectId: input.projectId,
                  createdAt: new Date().toISOString(),
                  cwd: sessionWorkspace.cwd,
                  ...(sessionWorkspace.worktree !== undefined
                    ? { worktree: sessionWorkspace.worktree }
                    : undefined),
                  ...(createdWorkspace.gitBranch !== undefined
                    ? { gitBranch: createdWorkspace.gitBranch }
                    : undefined),
                  ...(input.model !== undefined
                    ? { provider: input.model.provider, modelId: input.model.modelId }
                    : undefined),
                  ...(input.title !== undefined ? { title: input.title } : undefined),
                  archived: false,
                };
                return repo.write(metadata).pipe(
                  Effect.tapError(() =>
                    sessionWorkspace.worktree === undefined
                      ? Effect.void
                      : worktrees.remove(sessionWorkspace.cwd).pipe(Effect.ignore),
                  ),
                  Effect.tap(() => {
                    const model = input.model;
                    if (model === undefined) return Effect.void;
                    return Effect.tryPromise(() =>
                      persistDefaultPiModel(model.provider, model.modelId),
                    ).pipe(Effect.ignore);
                  }),
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
        resolveWorkspace(ref).pipe(
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
              return Effect.succeed<ReadonlyArray<PieUIMessage>>([]);
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
        Effect.fn("PiAgentSessionService.prompt")(function* () {
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

          const receipt = yield* deliverPrompt(input.ref, userInput).pipe(
            Effect.tapError((error) =>
              reject(error instanceof Error ? error.message : String(error)),
            ),
          );
          if (receipt.started) yield* submitted();
          return receipt;
        })().pipe(inSession(input.ref)),

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
              const persistModel = repo
                .write({
                  ...metadata,
                  provider: model.provider,
                  modelId: model.modelId,
                })
                .pipe(
                  Effect.tap(() =>
                    Effect.tryPromise(() =>
                      persistDefaultPiModel(model.provider, model.modelId),
                    ).pipe(Effect.ignore),
                  ),
                );
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
      pullRequestsFor: (ref) => readMetadata(ref).pipe(Effect.map(linksFor)),
      registerPullRequest,
      excludePullRequest,
      pullRequestContextFor: (ref) =>
        withMetadataMutation(
          ref,
          readMetadata(ref).pipe(
            Effect.flatMap((metadata) =>
              observedBranch(metadata).pipe(
                Effect.map((branch) => ({
                  links: linksFor(metadata),
                  generation: generation(ref),
                  cwd: metadata.cwd,
                  branch,
                  archived: metadata.archived ?? false,
                })),
              ),
            ),
          ),
        ),
      mergePullRequests: (ref, expected, updates) =>
        withMetadataMutation(
          ref,
          Effect.gen(function* () {
            const metadata = yield* readMetadata(ref);
            const branch = yield* observedBranch(metadata);
            if (
              generation(ref) !== expected.generation ||
              metadata.cwd !== expected.cwd ||
              branch !== expected.branch ||
              (metadata.archived ?? false) !== expected.archived
            )
              return false;
            const links = new Map(
              linksFor(metadata).map((link) => [pullRequestKey(link.ref), link]),
            );
            for (const update of updates) {
              const key = pullRequestKey(update.ref);
              const existing = links.get(key);
              if (existing?.excluded) continue;
              links.set(
                key,
                existing
                  ? {
                      ...existing,
                      snapshot: update.snapshot,
                      stack: update.stack,
                      stackCheckedAt: update.stackCheckedAt,
                    }
                  : update,
              );
            }
            const next = [...links.values()];
            if (JSON.stringify(next) === JSON.stringify(linksFor(metadata))) return true;
            yield* repo.write({ ...metadata, pullRequests: next });
            yield* changedPullRequests(ref);
            return true;
          }),
        ),

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
 * ProjectService, Paths, WorktreeService, GitService, and platform Crypto/FS.
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
  | GitService
  | Crypto.Crypto
  | FileSystem.FileSystem
> = PiAgentSessionServiceCoreLayer.pipe(
  Layer.provide(SessionMetadataLayer),
  Layer.provide(SessionMetadataLocksLayer),
  Layer.provide(PiAgentSessionRepositoryLayer),
);
