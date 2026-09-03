import type { SessionRef } from "@getpie/contract";

import { ModelSelect } from "@/components/model-select";
import { useSessionModels } from "@/features/chat/hooks/use-session-models";

export function ChatModelSelect({ sessionRef }: { sessionRef: SessionRef }) {
  const { models, providerId, modelId, isLoading, setModel, isSettingModel } =
    useSessionModels(sessionRef);

  if (isLoading || isSettingModel) return null;

  return (
    <ModelSelect models={models} providerId={providerId} modelId={modelId} onChange={setModel} />
  );
}
