import { Reasoning, ReasoningContent, ReasoningTrigger } from "@pie/ui/ai-elements/reasoning";
import type { ReasoningUIPart } from "ai";

// Renders one assistant reasoning block. Empty settled blocks are dropped;
// streaming blocks stay visible so the "Thinking..." trigger can show.
export function ReasoningPart({ part }: { part: ReasoningUIPart }) {
  const isStreaming = part.state === "streaming";
  if (!isStreaming && !part.text.trim()) return null;

  return (
    <Reasoning isStreaming={isStreaming} defaultOpen={isStreaming}>
      <ReasoningTrigger />
      <ReasoningContent>{part.text}</ReasoningContent>
    </Reasoning>
  );
}
