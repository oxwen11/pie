import type { SessionRef } from "@getpie/contract";
import { ModelSelectorPicker } from "@getpie/ui/ai-elements/model-selector";

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
