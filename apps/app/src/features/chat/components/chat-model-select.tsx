import type { SessionRef } from "@getpie/contract";

import { ModelSelectorPicker } from "@/components/model-selector/model-selector-picker";
import { useSessionModels } from "@/features/chat/hooks/use-session-models";

export function ChatModelSelect({ sessionRef }: { sessionRef: SessionRef }) {
  const { models, modelsError, modelsLoading, retryModels, providerId, modelId, setModel } =
    useSessionModels(sessionRef);

  return (
    <ModelSelectorPicker
      error={modelsError}
      modelId={modelId}
      models={models}
      onChange={setModel}
      onRetry={retryModels}
      providerId={providerId}
      loading={modelsLoading}
    />
  );
}
