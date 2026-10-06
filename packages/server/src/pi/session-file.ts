import fs from "node:fs";
import path from "node:path";

import { SessionManager } from "@earendil-works/pi-coding-agent";
import type { AgentModelState, PieUIMessage } from "@getpie/contract";
import { Effect } from "effect";

import { AgentOperationError, SessionNotResumable } from "../harness/errors";
import { entriesToUIMessages } from "./history";

const sessionFile = (agentSessionId: string, cwd: string): string | undefined => {
  const resolved = path.resolve(cwd);
  let real = resolved;
  try {
    real = fs.realpathSync(resolved);
  } catch {
    real = resolved;
  }
  return (
    SessionManager.findById(real, agentSessionId) ??
    (real === resolved ? undefined : SessionManager.findById(resolved, agentSessionId))
  );
};

/** Cold transcript read. Missing file is `SessionNotResumable`; a throw is an operation error. */
export const readPiSessionFile = (
  agentSessionId: string,
  cwd: string,
): Effect.Effect<
  { readonly messages: ReadonlyArray<PieUIMessage>; readonly model: AgentModelState },
  AgentOperationError | SessionNotResumable
> =>
  Effect.try({
    try: () => {
      const file = sessionFile(agentSessionId, cwd);
      return file === undefined ? undefined : SessionManager.open(file);
    },
    catch: (cause) =>
      new AgentOperationError({
        sessionId: agentSessionId,
        operation: "read-session",
        cause,
      }),
  }).pipe(
    Effect.flatMap((manager) => {
      if (manager === undefined) {
        return Effect.fail(new SessionNotResumable({ sessionId: agentSessionId }));
      }
      const model = manager.buildSessionProjection().model;
      return Effect.succeed({
        messages: entriesToUIMessages(manager.getEntries(), manager.getLeafId(), agentSessionId),
        model: model === null ? {} : { provider: model.provider, modelId: model.modelId },
      });
    }),
  );
