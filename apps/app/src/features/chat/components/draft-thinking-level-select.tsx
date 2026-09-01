import type { AgentThinkingLevel, ListAgentModelsInput } from "@getpie/contract";
import { useQuery } from "@tanstack/react-query";
import { useRouteContext } from "@tanstack/react-router";

import { ThinkingLevelSelect } from "./thinking-level-select";

export function DraftThinkingLevelSelect({
  projectId,
  providerId,
  modelId,
  level,
  disabled = false,
  onChange,
}: {
  projectId: string | undefined;
  providerId: string | undefined;
  modelId: string | undefined;
  level: AgentThinkingLevel | undefined;
  disabled?: boolean;
  onChange: (level: AgentThinkingLevel) => void;
}) {
  const { orpcQueryUtils } = useRouteContext({ from: "__root__" });
  const input: ListAgentModelsInput = projectId ? { projectId } : {};
  const modelsQuery = useQuery(orpcQueryUtils.agent.listModels.queryOptions({ input }));
  const model = modelsQuery.data?.models.find(
    (candidate) => candidate.provider === providerId && candidate.modelId === modelId,
  );

  if (modelsQuery.isLoading) return null;

  return (
    <ThinkingLevelSelect
      availableLevels={model?.availableThinkingLevels ?? []}
      disabled={disabled}
      level={level}
      onChange={onChange}
    />
  );
}
