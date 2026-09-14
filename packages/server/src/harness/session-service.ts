import type {
  AgentModelState,
  AgentResponse,
  CreateSessionOutput,
  CreateWorktreeInput,
  PromptInput,
  SessionRef,
  SessionRuntimeSnapshot,
  SessionStatus,
  SessionSummary,
  SessionCapabilities,
  SessionWorkspace,
} from "@getpie/contract";
import {
  PullRequestRefSchema,
  normalizePullRequestRef,
  pullRequestKey,
  type PullRequestRef,
  type PullRequestLinkSource,
  type SessionPullRequestLink,
} from "@getpie/contract/pull-request";
import type { UIMessage } from "ai";
import { Context, Crypto, Effect, FileSystem, Layer, Semaphore, Schema } from "effect";

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
import { GitService, type GitFailure } from "../git/service";
import {
  WorktreeService,
  type GitWorktreeCreateResult,
  type GitWorktreeFailure,
} from "../git/worktree-service";
import { ProjectService } from "../project/service";
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
import { PiSessionTools } from "./pi/session-tools";
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
  const collapsed = text.replaceAll(/\s+/g, " ");
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

type SessionWithCwd = Session & { readonly cwd: string };

const toSessionWorkspace = (metadata: SessionWithCwd): SessionWorkspace => ({
  cwd: metadata.cwd,
  ...(metadata.gitBranch !== undefined ? { gitBranch: metadata.gitBranch } : undefined),
});

export type SessionPullRequestContext = {
  readonly links: ReadonlyArray<SessionPullRequestLink>;
  readonly generation: number;
  readonly cwd: string | undefined;
  readonly branch: string | undefined;
  readonly archived: boolean;
};

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
  /** Compatibility for internal consumers; never queries GitHub. */
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
  readonly worktrees: {
    readonly create: (
      cwd: string,
      input?: { readonly base?: string },
    ) => Effect.Effect<GitWorktreeCreateResult, GitWorktreeFailure>;
    readonly remove: (path: string) => Effect.Effect<void, GitFailure>;
  };
  readonly newSessionId: Effect.Effect<string>;
  readonly branchFor?: (cwd: string) => Effect.Effect<string | undefined>;
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

  const generations = new Map<string, number>();
  const sessionKey = (ref: SessionRef) => `${ref.projectId}\0${ref.sessionId}`;
  const generation = (ref: SessionRef) => generations.get(sessionKey(ref)) ?? 0;
  const invalidate = (ref: SessionRef) =>
    Effect.sync(() => generations.set(sessionKey(ref), generation(ref) + 1));
  const linksFor = (metadata: Session): ReadonlyArray<SessionPullRequestLink> => {
    const links = new Map(
      (metadata.pullRequests ?? []).map((link) => [pullRequestKey(link.ref), link]),
    );
    for (const ref of metadata.pullRequestRefs ?? [])
      if (!links.has(pullRequestKey(ref)))
        links.set(pullRequestKey(ref), {
          ref: normalizePullRequestRef(ref),
          source: "legacy",
          linkedAt: metadata.createdAt,
          excluded: false,
          snapshot: null,
          stack: null,
          stackCheckedAt: null,
        });
    return [...links.values()];
  };
  const observedBranch = (metadata: Session) =>
    metadata.ownsWorktree && metadata.cwd && deps.branchFor
      ? deps.branchFor(metadata.cwd)
      : Effect.succeed(metadata.gitBranch);
  const changedPullRequests = (ref: SessionRef) =>
    bus.publish({ ref, type: "session.pull-requests.updated" });
  const registerPullRequest: PiAgentSessionServiceShape["registerPullRequest"] = (
    ref,
    rawRef,
    source = "agent",
    restore = false,
  ) =>
    withMetadataMutation(
      ref,
      Effect.gen(function* () {
        const pullRequest = normalizePullRequestRef(
          Schema.decodeUnknownSync(PullRequestRefSchema)(rawRef),
        );
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
        return "linked";
      }),
    );

  const withSessionTools = (ref: SessionRef) =>
    Effect.provideService(PiSessionTools, {
      list: readMetadata(ref).pipe(Effect.map(linksFor)),
      register: (pullRequest, restore) => registerPullRequest(ref, pullRequest, "agent", restore),
      exclude: (pullRequest) => service.excludePullRequest(ref, pullRequest),
    });

  const sessionNeverOpened = (metadata: Session): boolean => metadata.agentSessionId === undefined;

  const modelStateFromMetadata = (metadata: Session): AgentModelState => ({
    ...(metadata.provider !== undefined ? { provider: metadata.provider } : undefined),
    ...(metadata.modelId !== undefined ? { modelId: metadata.modelId } : undefined),
  });

  const ensureCwd = (
    metadata: Session,
  ): Effect.Effect<SessionWithCwd, ProjectNotFound | StoreReadError | StoreWriteError> =>
    metadata.cwd !== undefined
      ? Effect.succeed(metadata as SessionWithCwd)
      : projectPathFor(metadata.projectId).pipe(Effect.map((cwd) => ({ ...metadata, cwd })));

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
    }).pipe(withSessionTools(ref));

  const deliverPrompt = (
    ref: SessionRef,
    userInput: UserInput,
  ): Effect.Effect<
    void,
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
      const runtime = yield* withMetadataMutation(
        ref,
        readMetadata(ref).pipe(
          Effect.flatMap(ensureCwd),
          Effect.flatMap((resolved) => ensureRuntimeForPrompt(ref, resolved)),
        ),
      );
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
    return manager.ensureRuntime({ sessionId: agentSessionId, cwd }, ref).pipe(
      withSessionTools(ref),
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
  > =>
    manager
      .ensureRuntime(runtimeInput(agentSessionId, cwd), ref)
      .pipe(withSessionTools(ref), Effect.flatMap(run));

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

  const service: PiAgentSessionServiceShape = {
    create: (input) =>
      newSessionId.pipe(
        Effect.flatMap((sessionId) => {
          const ref: SessionRef = { projectId: input.projectId, sessionId };
          const materializeWorkspace: Effect.Effect<SessionWorkspace, GitWorktreeFailure> =
            input.worktree === undefined
              ? (deps.branchFor?.(input.cwd) ?? Effect.succeed(undefined)).pipe(
                  Effect.map((gitBranch) => ({
                    cwd: input.cwd,
                    ...(gitBranch ? { gitBranch } : undefined),
                  })),
                )
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
                ...(input.worktree === undefined ? undefined : { ownsWorktree: true }),
              };
              return repo.write(metadata).pipe(
                Effect.tapError(() =>
                  input.worktree === undefined
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
        readMetadata(ref).pipe(
          Effect.flatMap((metadata) =>
            ensureCwd(metadata).pipe(
              Effect.tap((resolved) =>
                metadata.cwd === undefined ? repo.write(resolved) : Effect.void,
              ),
            ),
          ),
        ),
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
          Effect.andThen(invalidate(ref)),
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
            const persist = changed
              ? repo.write({ ...metadata, archived }).pipe(Effect.andThen(invalidate(ref)))
              : Effect.void;
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

    pullRequestsFor: (ref) => readMetadata(ref).pipe(Effect.map(linksFor)),
    registerPullRequest,
    excludePullRequest: (ref, rawRef) =>
      withMetadataMutation(
        ref,
        Effect.gen(function* () {
          const pullRequest = normalizePullRequestRef(
            Schema.decodeUnknownSync(PullRequestRefSchema)(rawRef),
          );
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
      ),
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
          const links = new Map(linksFor(metadata).map((link) => [pullRequestKey(link.ref), link]));
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
    pullRequestRefsFor: (ref) =>
      readMetadata(ref).pipe(
        Effect.map((metadata) =>
          linksFor(metadata)
            .filter((link) => !link.excluded)
            .map((link) => link.ref),
        ),
      ),
    rememberPullRequestRef: (ref, pullRequest) =>
      registerPullRequest(ref, pullRequest).pipe(Effect.asVoid),

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
          if (sessionNeverOpened(metadata) || metadata.agentSessionId === undefined) {
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
        const userInput = yield* toUserInput(input.parts);
        yield* readAndStampTitleFromFirstPrompt(input.ref, input.parts);
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

        yield* deliverPrompt(input.ref, userInput).pipe(
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
        Effect.flatMap((metadata) => {
          if (sessionNeverOpened(metadata) || metadata.agentSessionId === undefined) {
            return Effect.succeed(modelStateFromMetadata(metadata));
          }
          const agentSessionId = metadata.agentSessionId;
          return ensureCwd(metadata).pipe(
            Effect.flatMap((resolved) =>
              withLiveRuntime(
                ref,
                agentSessionId,
                resolved.cwd,
                (runtime) =>
                  runtime.getModelState ??
                  Effect.fail(new CapabilityUnsupported({ capability: "getModelState" })),
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
            if (sessionNeverOpened(metadata) || metadata.agentSessionId === undefined) {
              return persistModel.pipe(Effect.as(model satisfies AgentModelState));
            }
            const agentSessionId = metadata.agentSessionId;
            return ensureCwd(metadata).pipe(
              Effect.flatMap((resolved) =>
                persistModel.pipe(
                  Effect.andThen(
                    withLiveRuntime(ref, agentSessionId, resolved.cwd, (runtime) =>
                      runtime.setModel
                        ? runtime.setModel(model)
                        : Effect.fail(new CapabilityUnsupported({ capability: "setModel" })),
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
          if (sessionNeverOpened(metadata) || metadata.agentSessionId === undefined) {
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
  };
  return service;
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
  | GitService
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
    const git = yield* GitService;
    const paths = yield* Paths;
    const crypto = yield* Crypto.Crypto;
    const repo = yield* makePiAgentSessionRepository(paths.sessionsDir);
    return makePiAgentSessionService({
      manager,
      pi,
      repo,
      bus,
      worktrees,
      branchFor: (cwd) =>
        git.branch(cwd).pipe(
          Effect.map((branch) =>
            branch.kind === "repository" ? (branch.current ?? undefined) : undefined,
          ),
          Effect.catch(() => Effect.succeed(undefined)),
        ),
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
