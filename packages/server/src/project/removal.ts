import { Context, Effect, Layer } from "effect";

import { ProjectNotFound, type StoreReadError, type StoreWriteError } from "../errors";
import type { EventBusShape } from "../events/event-bus";
import { EventBus } from "../events/event-bus";
import { ProjectSessionsBusy } from "../harness/errors";
import {
  ProjectSessionRemoval,
  type ProjectSessionRemovalShape,
} from "../harness/project-session-removal";
import { ProjectLifecycle, type ProjectLifecycleShape } from "../ownership/project-lifecycle";
import type { ProjectRepositoryShape } from "./repository";
import { ProjectRepository } from "./repository";

export type ProjectRemovalShape = {
  readonly remove: (
    projectId: string,
  ) => Effect.Effect<
    void,
    StoreReadError | StoreWriteError | ProjectNotFound | ProjectSessionsBusy
  >;
};

export class ProjectRemoval extends Context.Service<ProjectRemoval, ProjectRemovalShape>()(
  "ProjectRemoval",
) {}

export const makeProjectRemoval = (deps: {
  readonly bus: EventBusShape;
  readonly lifecycle: ProjectLifecycleShape;
  readonly projects: ProjectRepositoryShape;
  readonly sessions: ProjectSessionRemovalShape;
}): ProjectRemovalShape => {
  const { bus, lifecycle, projects, sessions } = deps;

  return {
    remove: (projectId) =>
      lifecycle.withRegistry(
        lifecycle.withProject(
          projectId,
          Effect.gen(function* () {
            const registered = yield* projects.list();
            if (!registered.some((project) => project.id === projectId)) {
              return yield* Effect.fail(new ProjectNotFound({ projectId }));
            }

            yield* Effect.acquireUseRelease(
              sessions.stage(projectId),
              (staged) =>
                projects
                  .save(registered.filter((project) => project.id !== projectId))
                  .pipe(
                    Effect.andThen(
                      staged.commit.pipe(
                        Effect.catch((commitError) =>
                          projects.save(registered).pipe(Effect.andThen(Effect.fail(commitError))),
                        ),
                      ),
                    ),
                    Effect.andThen(bus.publish({ type: "project.deleted", projectId })),
                  ),
              (staged) => staged.restore,
            );
          }).pipe(Effect.uninterruptible),
        ),
      ),
  };
};

export const ProjectRemovalLayer: Layer.Layer<
  ProjectRemoval,
  never,
  EventBus | ProjectLifecycle | ProjectRepository | ProjectSessionRemoval
> = Layer.effect(
  ProjectRemoval,
  Effect.gen(function* () {
    const bus = yield* EventBus;
    const lifecycle = yield* ProjectLifecycle;
    const projects = yield* ProjectRepository;
    const sessions = yield* ProjectSessionRemoval;
    yield* projects.list().pipe(
      Effect.flatMap((registered) =>
        sessions.recover(new Set(registered.map((project) => project.id))),
      ),
      Effect.catchTag("StoreReadError", (error) =>
        Effect.logWarning("could not recover interrupted Project removals").pipe(
          Effect.annotateLogs({
            event: "project.removal_recovery_failed",
            error,
          }),
        ),
      ),
      Effect.orDie,
    );
    return makeProjectRemoval({ bus, lifecycle, projects, sessions });
  }),
);
