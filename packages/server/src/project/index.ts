import { type Crypto, type FileSystem, Layer } from "effect";

import type { Paths } from "../config/paths";
import { ProjectLifecycleLayer } from "../ownership/project-lifecycle";
import { ProjectRepositoryLayer } from "./repository";
import { ProjectService, ProjectServiceLayer } from "./service";

export {
  makeProjectLifecycle,
  ProjectLifecycle,
  ProjectLifecycleLayer,
  type ProjectLifecycleShape,
} from "../ownership/project-lifecycle";
export {
  makeProjectRemoval,
  ProjectRemoval,
  ProjectRemovalLayer,
  type ProjectRemovalShape,
} from "./removal";
export { ProjectRepository, ProjectRepositoryLayer } from "./repository";
export { ProjectService, ProjectServiceLayer } from "./service";

/**
 * The project module fully wired — callers supply a `Paths` layer plus the
 * platform services the repository and id generation run on.
 */
export const ProjectModuleLayer: Layer.Layer<
  ProjectService,
  never,
  Paths | FileSystem.FileSystem | Crypto.Crypto
> = ProjectServiceLayer.pipe(
  Layer.provide(ProjectRepositoryLayer),
  Layer.provide(ProjectLifecycleLayer),
);
