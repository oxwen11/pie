import type { SessionRef } from "@getpie/contract";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useEnvironmentOrpc } from "@/lib/environment-orpc";

export function useSessionModels(ref: SessionRef) {
  const orpcQueryUtils = useEnvironmentOrpc();
  const queryClient = useQueryClient();

  const modelsQuery = useQuery(
    orpcQueryUtils.agent.listModels.queryOptions({ input: { projectId: ref.projectId } }),
  );
  const stateQuery = useQuery(
    orpcQueryUtils.agent.session.getModelState.queryOptions({ input: { ref } }),
  );

  const setModel = useMutation({
    mutationKey: orpcQueryUtils.agent.session.setModel.key(),
    mutationFn: ({ provider, modelId }: { provider: string; modelId: string }) =>
      orpcQueryUtils.agent.session.setModel.call({ ref, provider, modelId }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: orpcQueryUtils.agent.session.getModelState.key({ input: { ref } }),
      });
      void queryClient.invalidateQueries({
        queryKey: orpcQueryUtils.agent.listModels.key(),
      });
    },
  });

  return {
    models: modelsQuery.data?.models ?? [],
    providerId: stateQuery.data?.provider,
    modelId: stateQuery.data?.modelId,
    setModel: (provider: string, modelId: string) => setModel.mutate({ provider, modelId }),
  };
}
