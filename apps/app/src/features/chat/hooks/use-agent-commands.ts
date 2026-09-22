import { useQuery } from "@tanstack/react-query";

import { useEnvironmentOrpc } from "@/lib/environment-orpc";

/** Global Pi commands, overlaid with Project resources when a Project is selected. */
export function useAgentCommands(projectId: string | undefined) {
  const orpcQueryUtils = useEnvironmentOrpc();

  return useQuery({
    ...orpcQueryUtils.agent.commands.queryOptions({
      input: projectId === undefined ? {} : { projectId },
    }),
  });
}
