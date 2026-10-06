import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { AgentCommand } from "@getpie/contract";
import { type Duration, Effect } from "effect";

import { AgentOperationError } from "../errors";
import { runPiDiscoveryCommand } from "./discovery-command";

/**
 * Slash commands from pie-pi-process `get_commands` — the same RPC a live
 * session answers.
 */
export function listAvailablePiCommands(
  cwd?: string,
  agentDir = getAgentDir(),
  timeout?: Duration.Input,
): Effect.Effect<AgentCommand[], AgentOperationError> {
  return runPiDiscoveryCommand<{ commands?: AgentCommand[] }>({
    cwd: cwd ?? agentDir,
    agentDir,
    command: { type: "get_commands" },
    timeout,
  }).pipe(
    Effect.map((data) =>
      (data.commands ?? [])
        .filter((command) => command.name)
        .map(({ name, description, source }) => ({ name, description, source })),
    ),
    Effect.mapError(
      (cause) => new AgentOperationError({ sessionId: "", operation: "list-commands", cause }),
    ),
  );
}
