import type { ListAgentModelsInput } from "@getpie/contract";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouteContext } from "@tanstack/react-router";

import { ModelSelect } from "./model-select";

export function DraftModelSelect({
  projectId,
  providerId,
  modelId,
  onChange,
}: {
  projectId: string | undefined;
  providerId: string | undefined;
  modelId: string | undefined;
  onChange: (providerId: string, modelId: string) => void;
}) {
  const { orpcQueryUtils } = useRouteContext({ from: "__root__" });
  const queryClient = useQueryClient();
  const input: ListAgentModelsInput = projectId ? { projectId } : {};
  const modelsQuery = useQuery(orpcQueryUtils.agent.listModels.queryOptions({ input }));
  const setDefaultModel = useMutation({
    mutationFn: ({ provider, modelId: nextModelId }: { provider: string; modelId: string }) =>
      orpcQueryUtils.agent.setDefaultModel.call({
        ...(projectId !== undefined ? { projectId } : undefined),
        provider,
        modelId: nextModelId,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: orpcQueryUtils.agent.listModels.key(),
      });
    },
  });

  if (modelsQuery.isLoading) return null;

  return (
    <ModelSelect
      models={modelsQuery.data?.models ?? []}
      providerId={providerId}
      modelId={modelId}
      onChange={(provider, nextModelId) => {
        setDefaultModel.mutate({ provider, modelId: nextModelId });
        onChange(provider, nextModelId);
      }}
    />
  );
}
