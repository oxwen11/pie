import type { ListAgentModelsInput } from "@getpie/contract";
import { useQuery } from "@tanstack/react-query";
import { useRouteContext } from "@tanstack/react-router";

/** Cold Pi model catalog for draft (optional project) or session chrome. */
export function useAgentModels(projectId: string | undefined) {
  const { orpcQueryUtils } = useRouteContext({ from: "__root__" });
  const input: ListAgentModelsInput = projectId ? { projectId } : {};

  return useQuery({
    ...orpcQueryUtils.agent.listModels.queryOptions({ input }),
  });
}
