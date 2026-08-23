import type { SessionRef } from "@getpie/contract";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouteContext } from "@tanstack/react-router";

import { useAgentModels } from "@/features/chat/hooks/use-agent-models";

export function useSessionModels(ref: SessionRef) {
  const { orpcQueryUtils } = useRouteContext({ from: "__root__" });
  const queryClient = useQueryClient();

  const modelsQuery = useAgentModels(ref.projectId);
  const stateQuery = useQuery({
    ...orpcQueryUtils.agent.session.getModelState.queryOptions({ input: { ref } }),
  });

  const setModel = useMutation({
    mutationFn: ({ provider, modelId }: { provider: string; modelId: string }) =>
      orpcQueryUtils.agent.session.setModel.call({ ref, provider, modelId }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: orpcQueryUtils.agent.session.getModelState.key({ input: { ref } }),
      });
    },
  });

  return {
    models: modelsQuery.data?.models ?? [],
    providerId: stateQuery.data?.provider,
    modelId: stateQuery.data?.modelId,
    isLoading: modelsQuery.isLoading || stateQuery.isLoading,
    setModel: (provider: string, modelId: string) => setModel.mutate({ provider, modelId }),
    isSettingModel: setModel.isPending,
  };
}
