import type { SessionRef } from "@pie/contract";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouteContext } from "@tanstack/react-router";

export function useSessionModels(ref: SessionRef) {
  const { orpcQueryUtils } = useRouteContext({ from: "__root__" });
  const queryClient = useQueryClient();

  const modelsQuery = useQuery({
    ...orpcQueryUtils.agent.listModels.queryOptions({ input: { projectId: ref.projectId } }),
  });
  const stateQuery = useQuery({
    ...orpcQueryUtils.session.getModelState.queryOptions({ input: { ref } }),
  });

  const setModel = useMutation({
    mutationFn: ({ provider, modelId }: { provider: string; modelId: string }) =>
      orpcQueryUtils.session.setModel.call({ ref, provider, modelId }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: orpcQueryUtils.session.getModelState.key({ input: { ref } }),
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
