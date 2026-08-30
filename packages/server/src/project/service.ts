import path from "node:path";

import { Context, Crypto, Effect, Layer } from "effect";

import { ProjectNotFound, type StoreReadError, type StoreWriteError } from "../errors";
import { ProjectLifecycle } from "../ownership/project-lifecycle";
import type { Project } from "../types";
import { ProjectRepository } from "./repository";

/**
 * Project registry reads and path-deduplicating creation. Removal is the
 * cross-domain transaction in `removal.ts`.
 */
export class ProjectService extends Context.Service<
  ProjectService,
  {
    readonly list: () => Effect.Effect<ReadonlyArray<Project>, StoreReadError>;
    readonly findById: (id: string) => Effect.Effect<Project, StoreReadError | ProjectNotFound>;
    /** Keep a Project registered for the duration of an operation that creates owned state. */
    readonly withProject: <A, E>(
      id: string,
      use: (project: Project) => Effect.Effect<A, E>,
    ) => Effect.Effect<A, StoreReadError | ProjectNotFound | E>;
    /** The project registered at a workspace path, if any (paths are resolved). */
    readonly findByPath: (workspace: string) => Effect.Effect<Project | undefined, StoreReadError>;
    /** `name` defaults to the folder's basename. */
    readonly create: (input: {
      readonly name?: string;
      readonly path: string;
    }) => Effect.Effect<Project, StoreReadError | StoreWriteError>;
  }
>()("ProjectService") {}

export const ProjectServiceLayer: Layer.Layer<
  ProjectService,
  never,
  ProjectLifecycle | ProjectRepository | Crypto.Crypto
> = Layer.effect(
  ProjectService,
  Effect.gen(function* () {
    const repo = yield* ProjectRepository;
    const lifecycle = yield* ProjectLifecycle;
    const crypto = yield* Crypto.Crypto;
    // A platform RNG that cannot produce a uuid is a defect, not a domain
    // failure — keep it out of the service's error channel. Tag-specific so a
    // future recoverable error on this channel stays typed instead of dying.
    const newId = crypto.randomUUIDv4.pipe(
      Effect.catchTag("PlatformError", (cause) =>
        Effect.die(new Error("invariant: platform RNG failed minting a project id", { cause })),
      ),
    );
    const findById = (id: string) =>
      Effect.gen(function* () {
        const projects = yield* repo.list();
        const found = projects.find((project) => project.id === id);
        if (found === undefined) {
          return yield* Effect.fail(new ProjectNotFound({ projectId: id }));
        }
        return found;
      });
    return {
      list: () => repo.list(),

      findById,

      withProject: (id, use) => lifecycle.withProject(id, findById(id).pipe(Effect.flatMap(use))),

      findByPath: (workspace) =>
        Effect.gen(function* () {
          const projects = yield* repo.list();
          const target = path.resolve(workspace);
          return projects.find((p) => path.resolve(p.path) === target);
        }),

      create: (input) =>
        lifecycle.withRegistry(
          Effect.gen(function* () {
            const normalized = path.resolve(input.path);
            const projects = yield* repo.list();
            // Reuse an existing project pointing at the same path.
            const existing = projects.find((p) => path.resolve(p.path) === normalized);
            if (existing !== undefined) return existing;

            const project: Project = {
              id: yield* newId,
              name: input.name ?? path.basename(normalized),
              path: normalized,
              createdAt: new Date().toISOString(),
            };
            yield* repo.save([...projects, project]);
            return project;
          }),
        ),
    };
  }),
);
