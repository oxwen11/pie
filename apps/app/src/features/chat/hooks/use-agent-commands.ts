import { useQuery } from "@tanstack/react-query";
import { useRouteContext } from "@tanstack/react-router";

/** Global Pi commands, overlaid with Project resources when a Project is selected. */
export function useAgentCommands(projectId: string | undefined) {
  const { orpcQueryUtils } = useRouteContext({ from: "__root__" });

  return useQuery({
    ...orpcQueryUtils.agent.commands.queryOptions({
      input: projectId === undefined ? {} : { projectId },
    }),
  });
}
