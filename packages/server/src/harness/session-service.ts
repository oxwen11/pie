import { Context, Crypto, Effect, FileSystem, Layer } from "effect";

import { Paths } from "../config/paths";
import { EventBus } from "../events/event-bus";
import { WorktreeService } from "../git/worktree-service";
import { ProjectService } from "../project/service";
import { PiAgent } from "./pi/agent";
import {
  SessionLifecycle,
  SessionLifecycleLayer,
  type SessionLifecycleShape,
} from "./session-lifecycle";
import { SessionMetadataLocksLayer } from "./session-locks";
import { PiAgentSessionManager } from "./session-manager";
import {
  SessionMetadata,
  SessionMetadataLayer,
  type SessionMetadataShape,
} from "./session-metadata";
import { PiAgentSessionRepositoryLayer } from "./session-repository";
import { SessionTurn, SessionTurnLayer, type SessionTurnShape } from "./session-turn";

export type { CreatePiSessionInput } from "./session-lifecycle";

export type PiAgentSessionServiceShape = SessionLifecycleShape &
  SessionTurnShape &
  Pick<
    SessionMetadataShape,
    "workspaceFor" | "rename" | "archive" | "pullRequestRefsFor" | "rememberPullRequestRef" | "list"
  >;

export class PiAgentSessionService extends Context.Service<
  PiAgentSessionService,
  PiAgentSessionServiceShape
>()("PiAgentSessionService") {}

export const PiAgentSessionServiceFromPartsLayer: Layer.Layer<
  PiAgentSessionService,
  never,
  SessionLifecycle | SessionTurn | SessionMetadata
> = Layer.effect(
  PiAgentSessionService,
  Effect.gen(function* () {
    const lifecycle = yield* SessionLifecycle;
    const turn = yield* SessionTurn;
    const metadata = yield* SessionMetadata;
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
  }),
);

/**
 * Outward session face. Child services (`SessionMetadata`, `SessionLifecycle`,
 * `SessionTurn`) take their collaborators through Effect `R`; this Layer is
 * the only place they are assembled.
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
> = PiAgentSessionServiceFromPartsLayer.pipe(
  Layer.provide(SessionTurnLayer),
  Layer.provide(SessionLifecycleLayer),
  Layer.provide(SessionMetadataLayer),
  Layer.provide(SessionMetadataLocksLayer),
  Layer.provide(PiAgentSessionRepositoryLayer),
);
