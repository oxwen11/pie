import type { SessionRef } from "@pie/contract";

import { useSessionModels } from "@/features/chat/hooks/use-session-models";

import { ModelSelect } from "./model-select";

export function ChatModelSelect({ sessionRef }: { sessionRef: SessionRef }) {
  const { models, providerId, modelId, isLoading, setModel, isSettingModel } =
    useSessionModels(sessionRef);

  if (isLoading || isSettingModel) return null;

  return (
    <ModelSelect models={models} providerId={providerId} modelId={modelId} onChange={setModel} />
  );
}
