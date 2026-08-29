import type { SessionRef } from "@getpie/contract";
import { useMutationState } from "@tanstack/react-query";

export const sessionModelMutationKey = (ref: SessionRef) =>
  ["session-model", ref.projectId, ref.sessionId] as const;

export const sessionThinkingMutationKey = (ref: SessionRef) =>
  ["session-thinking", ref.projectId, ref.sessionId] as const;

export function useSessionConfigurationPending(ref: SessionRef): boolean {
  const modelMutations = useMutationState({
    filters: { mutationKey: sessionModelMutationKey(ref), status: "pending" },
  });
  const thinkingMutations = useMutationState({
    filters: { mutationKey: sessionThinkingMutationKey(ref), status: "pending" },
  });
  return modelMutations.length > 0 || thinkingMutations.length > 0;
}
