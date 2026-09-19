import type { SessionRef } from "@getpie/contract";

import { ModelSelectorPicker } from "@/components/model-selector/model-selector-picker";
import { useSessionModels } from "@/features/chat/hooks/use-session-models";

export function ChatModelSelect({ sessionRef }: { sessionRef: SessionRef }) {
  const { models, providerId, modelId, isLoading, setModel, isSettingModel } =
    useSessionModels(sessionRef);

  if (isLoading || isSettingModel) return null;

  return (
    <ModelSelectorPicker
      modelId={modelId}
      models={models}
      onChange={setModel}
      providerId={providerId}
    />
  );
}
