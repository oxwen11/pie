import type {
  CreateSessionOutput,
  CreateWorktreeInput,
  SessionRef,
  SessionWorkspace,
} from "@getpie/contract";
import { Context, Crypto, Effect, Layer } from "effect";

import type {
  ProjectNotFound,
  SessionNotFound,
  SessionRefNotFound,
  StoreReadError,
  StoreWriteError,
} from "../errors";
import { EventBus } from "../events/event-bus";
import { WorktreeService, type GitWorktreeFailure } from "../git/worktree-service";
import type { Session } from "../types";
import { type AgentOperationError, SessionNotResumable } from "./errors";
import { PiAgent } from "./pi/agent";
import { inSession } from "./session-identity";
import { SessionMetadataLocks } from "./session-locks";
import { PiAgentSessionManager } from "./session-manager";
import { logLifecycle, SessionMetadata, toSessionWorkspace } from "./session-metadata";
import { PiAgentSessionRepository } from "./session-repository";

export type CreatePiSessionInput = {
  readonly projectId: string;
  readonly cwd: string;
  readonly model?: { readonly provider: string; readonly modelId: string };
  readonly worktree?: CreateWorktreeInput;
};

export type SessionLifecycleShape = {
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
};

export class SessionLifecycle extends Context.Service<SessionLifecycle, SessionLifecycleShape>()(
  "SessionLifecycle",
) {}

export const SessionLifecycleLayer: Layer.Layer<
  SessionLifecycle,
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
  SessionLifecycle,
  Effect.gen(function* () {
    const manager = yield* PiAgentSessionManager;
    const pi = yield* PiAgent;
    const repo = yield* PiAgentSessionRepository;
    const bus = yield* EventBus;
    const worktrees = yield* WorktreeService;
    const crypto = yield* Crypto.Crypto;
    const sessionMetadata = yield* SessionMetadata;
    const locks = yield* SessionMetadataLocks;
    const { readMetadata, ensureCwd } = sessionMetadata;
    const withMetadataMutation = locks.withLock;
    const newSessionId = crypto.randomUUIDv4.pipe(
      Effect.catchTag("PlatformError", (cause) =>
        Effect.die(new Error("invariant: platform RNG failed minting a session id", { cause })),
      ),
    );

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
    } satisfies SessionLifecycleShape;
  }),
);
