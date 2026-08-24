import type { GitWorkspaceInput } from "@getpie/contract/git";
import { Effect } from "effect";

import type { ProjectNotFound, SessionNotFound, StoreReadError, StoreWriteError } from "../errors";
import { PiAgentSessionService } from "../harness";

export const resolveGitWorkspaceCwd = (
  input: GitWorkspaceInput,
): Effect.Effect<
  string,
  SessionNotFound | ProjectNotFound | StoreReadError | StoreWriteError,
  PiAgentSessionService
> =>
  Effect.gen(function* () {
    if ("ref" in input) {
      const sessions = yield* PiAgentSessionService;
      const workspace = yield* sessions.workspaceFor(input.ref);
      return workspace.cwd;
    }
    return input.cwd;
  });
