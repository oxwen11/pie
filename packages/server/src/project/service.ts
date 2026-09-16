import path from "node:path";

import { Context, Crypto, Effect, FileSystem, Layer, type PlatformError } from "effect";

import {
  ProjectFolderConflict,
  ProjectFolderCreateError,
  ProjectNotFound,
  type StoreReadError,
  type StoreWriteError,
  WorkspaceNotDirectory,
  WorkspacePathEscape,
  WorkspaceReadError,
} from "../errors";
import { contains } from "../path-safety";
import type { Project } from "../types";
import {
  ALLOCATE_FOLDER_ATTEMPTS,
  allocateProjectFolderName,
  resolveNewProjectRoot,
} from "./allocate-folder";
import { ProjectRepository } from "./repository";

export type AllocateProjectError =
  | StoreReadError
  | StoreWriteError
  | WorkspaceNotDirectory
  | WorkspacePathEscape
  | WorkspaceReadError
  | ProjectFolderCreateError
  | ProjectFolderConflict;

const isAlreadyExists = (error: PlatformError.PlatformError): boolean =>
  error.reason._tag === "AlreadyExists";

/**
 * `project` module: list / create (path-dedup) / allocate / remove / findById.
 * Business rules live here; persistence is delegated to the repo.
 */
export class ProjectService extends Context.Service<
  ProjectService,
  {
    readonly list: () => Effect.Effect<ReadonlyArray<Project>, StoreReadError>;
    readonly findById: (id: string) => Effect.Effect<Project, StoreReadError | ProjectNotFound>;
    /** The project registered at a workspace path, if any (paths are resolved). */
    readonly findByPath: (workspace: string) => Effect.Effect<Project | undefined, StoreReadError>;
    /** `name` defaults to the folder's basename. */
    readonly create: (input: {
      readonly name?: string;
      readonly path: string;
    }) => Effect.Effect<Project, StoreReadError | StoreWriteError>;
    /**
     * Mint an empty folder under the new-project root and register it.
     * `now` is for tests; the RPC always uses the clock at the call.
     */
    readonly allocate: (input?: {
      readonly title?: string;
      readonly now?: Date;
    }) => Effect.Effect<Project, AllocateProjectError>;
    /** Resolved parent directory; does not create it. */
    readonly allocateRoot: () => Effect.Effect<{ readonly path: string }>;
    readonly remove: (
      id: string,
    ) => Effect.Effect<void, StoreReadError | StoreWriteError | ProjectNotFound>;
  }
>()("ProjectService") {}

export const ProjectServiceLayer: Layer.Layer<
  ProjectService,
  never,
  ProjectRepository | Crypto.Crypto | FileSystem.FileSystem
> = Layer.effect(
  ProjectService,
  Effect.gen(function* () {
    const repo = yield* ProjectRepository;
    const crypto = yield* Crypto.Crypto;
    const fs = yield* FileSystem.FileSystem;
    // A platform RNG that cannot produce a uuid is a defect, not a domain
    // failure — keep it out of the service's error channel. Tag-specific so a
    // future recoverable error on this channel stays typed instead of dying.
    const newId = crypto.randomUUIDv4.pipe(
      Effect.catchTag("PlatformError", (cause) =>
        Effect.die(new Error("invariant: platform RNG failed minting a project id", { cause })),
      ),
    );

    const create = Effect.fn("ProjectService.create")(function* (input: {
      readonly name?: string;
      readonly path: string;
    }) {
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
    });

    const ensureRoot = Effect.fn("ProjectService.ensureAllocateRoot")(function* (root: string) {
      yield* fs.makeDirectory(root, { recursive: true }).pipe(
        Effect.catchIf(isAlreadyExists, () => Effect.void),
        Effect.mapError((cause) => new ProjectFolderCreateError({ path: root, cause })),
      );
      const info = yield* fs
        .stat(root)
        .pipe(Effect.mapError((cause) => new WorkspaceReadError({ path: root, cause })));
      if (info.type !== "Directory") {
        return yield* new WorkspaceNotDirectory({ path: root });
      }
      return root;
    });

    const tryCreateFolder = (folder: string) =>
      fs.makeDirectory(folder).pipe(
        Effect.as(true),
        Effect.catchIf(isAlreadyExists, () => Effect.succeed(false)),
        Effect.mapError((cause) => new ProjectFolderCreateError({ path: folder, cause })),
      );

    return {
      list: Effect.fn("ProjectService.list")(function* () {
        return yield* repo.list();
      }),

      findById: Effect.fn("ProjectService.findById")(function* (id: string) {
        const projects = yield* repo.list();
        const found = projects.find((p) => p.id === id);
        if (found === undefined) {
          return yield* Effect.fail(new ProjectNotFound({ projectId: id }));
        }
        return found;
      }),

      findByPath: Effect.fn("ProjectService.findByPath")(function* (workspace: string) {
        const projects = yield* repo.list();
        const target = path.resolve(workspace);
        return projects.find((p) => path.resolve(p.path) === target);
      }),

      create,

      allocate: Effect.fn("ProjectService.allocate")(function* (input?: {
        readonly title?: string;
        readonly now?: Date;
      }) {
        const root = yield* ensureRoot(resolveNewProjectRoot());
        const now = input?.now ?? new Date();
        for (let attempt = 1; attempt <= ALLOCATE_FOLDER_ATTEMPTS; attempt++) {
          const name = allocateProjectFolderName(now, input?.title, attempt);
          const folder = path.resolve(root, name);
          if (path.relative(root, folder) !== name || !contains(root, folder)) {
            return yield* new WorkspacePathEscape({ cwd: root, path: folder });
          }
          const parent = path.dirname(folder);
          if (!contains(root, parent)) {
            return yield* new WorkspacePathEscape({ cwd: root, path: parent });
          }
          yield* fs.makeDirectory(parent, { recursive: true }).pipe(
            Effect.catchIf(isAlreadyExists, () => Effect.void),
            Effect.mapError((cause) => new ProjectFolderCreateError({ path: parent, cause })),
          );
          if (yield* tryCreateFolder(folder)) {
            return yield* create({ path: folder });
          }
        }
        return yield* new ProjectFolderConflict({
          root,
          name: allocateProjectFolderName(now, input?.title, ALLOCATE_FOLDER_ATTEMPTS),
        });
      }),

      allocateRoot: () => Effect.sync(() => ({ path: resolveNewProjectRoot() })),

      remove: Effect.fn("ProjectService.remove")(function* (id: string) {
        const projects = yield* repo.list();
        const target = projects.find((p) => p.id === id);
        if (target === undefined) {
          return yield* Effect.fail(new ProjectNotFound({ projectId: id }));
        }
        yield* repo.save(projects.filter((p) => p.id !== id));
        return undefined;
      }),
    };
  }),
);
