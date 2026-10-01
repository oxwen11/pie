import { getAgentDir } from "@earendil-works/pi-coding-agent";
import * as NodeServices from "@effect/platform-node/NodeServices";
import type { AgentCommand } from "@getpie/contract";
import { Effect, Stream } from "effect";

import { PI_PROJECT_PROCESS_ARGS } from "./project-resource-policy";
import { declineUiResponse } from "./request";
import { resolvePiExecutable } from "./resolve-executable";
import { makePiTransport } from "./transport";

/**
 * Slash commands from pie-pi-process `get_commands` — the same RPC a live
 * session answers.
 */
export function listAvailablePiCommands(
  cwd?: string,
  agentDir = getAgentDir(),
): Promise<AgentCommand[]> {
  return Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const transport = yield* makePiTransport({
          executable: resolvePiExecutable(),
          cwd: cwd ?? agentDir,
          args: cwd === undefined ? [] : PI_PROJECT_PROCESS_ARGS,
          env: { PI_CODING_AGENT_DIR: agentDir },
        });
        // Discovery has no interactive consumer, including during session_start.
        // Always send an explicit decline rather than leave a dialog pending.
        yield* Stream.runForEach(transport.uiRequests, (request) =>
          transport.respondUi(declineUiResponse(request)),
        ).pipe(Effect.forkScoped);
        const data = yield* transport.command<{ commands?: AgentCommand[] }>({
          type: "get_commands",
        });
        return (data.commands ?? [])
          .filter((command) => command.name)
          .map(({ name, description, source }) => ({ name, description, source }));
      }),
    ).pipe(Effect.provide(NodeServices.layer)),
  );
}
