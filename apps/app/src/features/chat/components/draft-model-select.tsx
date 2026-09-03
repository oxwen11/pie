import type { ListAgentModelsInput } from "@getpie/contract";
import { useQuery } from "@tanstack/react-query";
import { useRouteContext } from "@tanstack/react-router";

import { ModelSelect } from "@/components/model-select";

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
  const input: ListAgentModelsInput = projectId ? { projectId } : {};
  const modelsQuery = useQuery(orpcQueryUtils.agent.listModels.queryOptions({ input }));

  if (modelsQuery.isLoading) return null;

  return (
    <ModelSelect
      models={modelsQuery.data?.models ?? []}
      providerId={providerId}
      modelId={modelId}
      onChange={onChange}
    />
  );
}
