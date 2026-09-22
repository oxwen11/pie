// oxlint-disable typescript/no-unnecessary-type-parameters -- E preserves the caller's oRPC error constructor
import type { WorkspaceQuery } from "@getpie/contract";
import { Effect } from "effect";

import { ProjectNotFound, SessionNotFound, StoreReadError } from "../errors";
import { SessionMetadata } from "../harness/session-metadata";

export const resolveWorkspaceCwd = (
  input: WorkspaceQuery,
): Effect.Effect<string, SessionNotFound | ProjectNotFound | StoreReadError, SessionMetadata> =>
  Effect.gen(function* () {
    if ("ref" in input) {
      const metadata = yield* SessionMetadata;
      const workspace = yield* metadata.workspaceFor(input.ref);
      return workspace.cwd;
    }
    return input.cwd;
  });

export const catchWorkspaceResolveErrors = <
  E extends { SESSION_NOT_FOUND: (input: { data: { message: string } }) => unknown },
>(
  errors: E,
) =>
  Effect.catchTags({
    SessionNotFound: (error: SessionNotFound) =>
      Effect.fail(
        errors.SESSION_NOT_FOUND({
          data: { message: `session ${error.sessionId} not found` },
        }),
      ),
    ProjectNotFound: (error: ProjectNotFound) =>
      Effect.fail(
        errors.SESSION_NOT_FOUND({
          data: { message: `project ${error.projectId} not found` },
        }),
      ),
    StoreReadError: (error: StoreReadError) =>
      Effect.fail(
        errors.SESSION_NOT_FOUND({
          data: { message: `session store read failed: ${error.file}` },
        }),
      ),
  });

export const resolveWorkspaceCwdOrFail = <
  E extends { SESSION_NOT_FOUND: (input: { data: { message: string } }) => unknown },
>(
  input: WorkspaceQuery,
  errors: E,
) => resolveWorkspaceCwd(input).pipe(catchWorkspaceResolveErrors(errors));
