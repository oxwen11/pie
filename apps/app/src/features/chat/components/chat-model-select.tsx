import type { SessionRef } from "@getpie/contract";

import { useSessionConfigurationPending } from "@/features/chat/hooks/use-session-configuration-pending";
import { useSessionModels } from "@/features/chat/hooks/use-session-models";

import { ModelSelect } from "./model-select";

export function ChatModelSelect({ sessionRef }: { sessionRef: SessionRef }) {
  const { models, providerId, modelId, isLoading, setModel } = useSessionModels(sessionRef);
  const configurationPending = useSessionConfigurationPending(sessionRef);

  if (isLoading) return null;

  return (
    <ModelSelect
      disabled={configurationPending}
      models={models}
      providerId={providerId}
      modelId={modelId}
      onChange={setModel}
    />
  );
}
