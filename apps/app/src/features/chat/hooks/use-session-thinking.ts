import type { AgentThinkingLevel, SessionRef } from "@getpie/contract";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouteContext } from "@tanstack/react-router";

import { sessionThinkingMutationKey } from "./use-session-configuration-pending";

export function useSessionThinking(ref: SessionRef) {
  const { orpcQueryUtils } = useRouteContext({ from: "__root__" });
  const queryClient = useQueryClient();

  const modelsQuery = useQuery(
    orpcQueryUtils.agent.listModels.queryOptions({ input: { projectId: ref.projectId } }),
  );
  const modelStateQuery = useQuery(
    orpcQueryUtils.agent.session.getModelState.queryOptions({ input: { ref } }),
  );
  const thinkingStateOptions = orpcQueryUtils.agent.session.getThinkingState.queryOptions({
    input: { ref },
  });
  const thinkingStateQuery = useQuery(thinkingStateOptions);

  const selectedModel = modelsQuery.data?.models.find(
    (model) =>
      model.provider === modelStateQuery.data?.provider &&
      model.modelId === modelStateQuery.data?.modelId,
  );
  const liveLevels = thinkingStateQuery.data?.availableLevels ?? [];
  const availableLevels =
    liveLevels.length > 0 ? liveLevels : (selectedModel?.availableThinkingLevels ?? []);

  const setThinkingLevel = useMutation({
    mutationKey: sessionThinkingMutationKey(ref),
    mutationFn: (level: AgentThinkingLevel) =>
      orpcQueryUtils.agent.session.setThinkingLevel.call({ ref, level }),
    onSuccess: (state) => {
      queryClient.setQueryData(thinkingStateOptions.queryKey, state);
    },
  });

  return {
    level: thinkingStateQuery.data?.level,
    availableLevels,
    isLoading: modelsQuery.isLoading || modelStateQuery.isLoading || thinkingStateQuery.isLoading,
    setThinkingLevel: (level: AgentThinkingLevel) => setThinkingLevel.mutate(level),
    isSettingThinkingLevel: setThinkingLevel.isPending,
  };
}
