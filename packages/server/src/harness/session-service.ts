import { Context, Crypto, Effect, FileSystem, Layer } from "effect";

import { Paths } from "../config/paths";
import { ProjectNotFound, type StoreReadError } from "../errors";
import { EventBus, type EventBusShape } from "../events/event-bus";
import type { GitFailure } from "../git/service";
import {
  WorktreeService,
  type GitWorktreeCreateResult,
  type GitWorktreeFailure,
} from "../git/worktree-service";
import { ProjectService } from "../project/service";
import type { PiAgentShape } from "./pi/agent";
import { PiAgent } from "./pi/agent";
import { makeSessionLifecycle, type SessionLifecycle } from "./session-lifecycle";
import { makeSessionMetadataLocks, type SessionMetadataLocks } from "./session-locks";
import type { PiAgentSessionManagerShape } from "./session-manager";
import { PiAgentSessionManager } from "./session-manager";
import { makeSessionMetadata, type SessionMetadata } from "./session-metadata";
import {
  type PiAgentSessionRepositoryShape,
  makePiAgentSessionRepository,
} from "./session-repository";
import { makeSessionTurn, type SessionTurn } from "./session-turn";

export type { CreatePiSessionInput } from "./session-lifecycle";

export type PiAgentSessionServiceShape = SessionLifecycle &
  SessionTurn &
  Pick<
    SessionMetadata,
    "workspaceFor" | "rename" | "archive" | "pullRequestRefsFor" | "rememberPullRequestRef" | "list"
  >;

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
  readonly locks?: SessionMetadataLocks;
}): PiAgentSessionServiceShape => {
  const { manager, pi, repo, bus, worktrees, newSessionId, projectPathFor } = deps;
  const locks = deps.locks ?? makeSessionMetadataLocks();
  const metadata = makeSessionMetadata({ repo, bus, locks, projectPathFor, manager });
  const lifecycle = makeSessionLifecycle({
    manager,
    pi,
    repo,
    bus,
    worktrees,
    newSessionId,
    metadata,
    locks,
  });
  const turn = makeSessionTurn({ manager, pi, repo, metadata, locks, newSessionId });
  return {
    ...lifecycle,
    ...turn,
    workspaceFor: metadata.workspaceFor,
    rename: metadata.rename,
    archive: metadata.archive,
    pullRequestRefsFor: metadata.pullRequestRefsFor,
    rememberPullRequestRef: metadata.rememberPullRequestRef,
    list: metadata.list,
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
