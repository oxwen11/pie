import type { SessionRef } from "@getpie/contract";
import { Context, Effect, FileSystem, Layer } from "effect";

import { Paths } from "../config/paths";
import type { StoreReadError, StoreWriteError } from "../errors";
import { EventBus, type EventBusShape } from "../events/event-bus";
import { ProjectSessionsBusy } from "./errors";
import { PiAgentSessionManager, type PiAgentSessionManagerShape } from "./session-manager";
import {
  makePiAgentSessionRepository,
  type PiAgentSessionRepositoryShape,
} from "./session-repository";

export type ProjectSessionRemovalTransaction = {
  readonly commit: Effect.Effect<void, StoreWriteError>;
  readonly restore: Effect.Effect<void, StoreWriteError>;
};

export type ProjectSessionRemovalShape = {
  /** Recover or finish durable staging left by a process that stopped mid-removal. */
  readonly recover: (
    registeredProjectIds: ReadonlySet<string>,
  ) => Effect.Effect<void, StoreWriteError>;
  /**
   * Prepare all Session-owned data for one Project for permanent removal.
   * Fails before moving metadata when any Session still owns accepted work.
   */
  readonly stage: (
    projectId: string,
  ) => Effect.Effect<
    ProjectSessionRemovalTransaction,
    StoreReadError | StoreWriteError | ProjectSessionsBusy
  >;
};

export class ProjectSessionRemoval extends Context.Service<
  ProjectSessionRemoval,
  ProjectSessionRemovalShape
>()("ProjectSessionRemoval") {}

export const makeProjectSessionRemoval = (deps: {
  readonly bus: EventBusShape;
  readonly manager: PiAgentSessionManagerShape;
  readonly sessions: PiAgentSessionRepositoryShape;
}): ProjectSessionRemovalShape => {
  const { bus, manager, sessions } = deps;

  return {
    recover: (registeredProjectIds) => sessions.recoverProjectRemovals(registeredProjectIds),

    stage: (projectId) =>
      Effect.gen(function* () {
        const metadata = yield* sessions.list(projectId);
        const busy = yield* Effect.filter(metadata, (session) =>
          manager.isBusy({ projectId: session.projectId, sessionId: session.sessionId }),
        );
        if (busy.length > 0) {
          return yield* Effect.fail(
            new ProjectSessionsBusy({
              projectId,
              sessionIds: busy.map((session) => session.sessionId),
            }),
          );
        }

        const staged = yield* sessions.stageProjectRemoval(projectId);
        const refs: ReadonlyArray<SessionRef> = metadata.map((session) => ({
          projectId: session.projectId,
          sessionId: session.sessionId,
        }));
        yield* Effect.forEach(refs, manager.close, { discard: true });

        const publishDeletion = Effect.forEach(
          refs,
          (ref) =>
            bus
              .closeSession(ref, "session_deleted")
              .pipe(
                Effect.andThen(bus.publish({ ref, type: "session.deleted" })),
                Effect.andThen(
                  Effect.logInfo("session deleted").pipe(
                    Effect.annotateLogs({ event: "session.deleted" }),
                  ),
                ),
              ),
          { discard: true },
        );

        return {
          commit: staged.commit.pipe(Effect.andThen(publishDeletion), Effect.uninterruptible),
          restore: staged.restore,
        } satisfies ProjectSessionRemovalTransaction;
      }).pipe(Effect.uninterruptible),
  };
};

export const ProjectSessionRemovalLayer: Layer.Layer<
  ProjectSessionRemoval,
  never,
  EventBus | FileSystem.FileSystem | Paths | PiAgentSessionManager
> = Layer.effect(
  ProjectSessionRemoval,
  Effect.gen(function* () {
    const bus = yield* EventBus;
    const manager = yield* PiAgentSessionManager;
    const paths = yield* Paths;
    const sessions = yield* makePiAgentSessionRepository(paths.sessionsDir);
    return makeProjectSessionRemoval({ bus, manager, sessions });
  }),
);
