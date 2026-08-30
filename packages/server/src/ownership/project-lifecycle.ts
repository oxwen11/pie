import { Context, Effect, Layer, Semaphore } from "effect";

export type ProjectLifecycleShape = {
  readonly withRegistry: <A, E>(effect: Effect.Effect<A, E>) => Effect.Effect<A, E>;
  readonly withProject: <A, E>(
    projectId: string,
    effect: Effect.Effect<A, E>,
  ) => Effect.Effect<A, E>;
};

/** Neutral coordinator for operations that create, use, or remove Project-owned state. */
export const makeProjectLifecycle = (): ProjectLifecycleShape => {
  const locks = new Map<string, ReturnType<typeof Semaphore.makeUnsafe>>();
  const registryLock = Semaphore.makeUnsafe(1);

  return {
    withRegistry: (effect) => registryLock.withPermit(effect),
    withProject: (projectId, effect) =>
      Effect.suspend(() => {
        const lock = locks.get(projectId) ?? Semaphore.makeUnsafe(1);
        locks.set(projectId, lock);
        return lock.withPermit(effect);
      }),
  };
};

export class ProjectLifecycle extends Context.Service<ProjectLifecycle, ProjectLifecycleShape>()(
  "ProjectLifecycle",
) {}

export const ProjectLifecycleLayer = Layer.sync(ProjectLifecycle, makeProjectLifecycle);
