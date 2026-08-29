import type { SessionRef } from "@getpie/contract";

import { useSessionConfigurationPending } from "@/features/chat/hooks/use-session-configuration-pending";
import { useSessionThinking } from "@/features/chat/hooks/use-session-thinking";

import { ThinkingLevelSelect } from "./thinking-level-select";

export function ChatThinkingLevelSelect({ sessionRef }: { sessionRef: SessionRef }) {
  const { level, availableLevels, isLoading, setThinkingLevel } = useSessionThinking(sessionRef);
  const configurationPending = useSessionConfigurationPending(sessionRef);

  if (isLoading) return null;

  return (
    <ThinkingLevelSelect
      availableLevels={availableLevels}
      disabled={configurationPending}
      level={level}
      onChange={setThinkingLevel}
    />
  );
}
