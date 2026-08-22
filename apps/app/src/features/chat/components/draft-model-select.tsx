import { useAgentModels } from "@/features/chat/hooks/use-agent-models";

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
  const modelsQuery = useAgentModels(projectId);

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
