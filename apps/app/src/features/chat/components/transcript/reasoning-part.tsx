import { Reasoning, ReasoningContent, ReasoningTrigger } from "@getpie/ui/ai-elements/reasoning";
import type { ReasoningUIPart } from "ai";

import { shouldRenderReasoningPart } from "./reasoning-part.logic";

// Renders one assistant reasoning block. Empty settled blocks are dropped;
// streaming blocks stay visible so the "Thinking..." trigger can show.
export function ReasoningPart({
  part,
  isMessageStreaming = false,
}: {
  part: ReasoningUIPart;
  /** True while the parent assistant turn is still streaming. */
  isMessageStreaming?: boolean;
}) {
  const text = part.text ?? "";
  const isReasoningStreaming = part.state === "streaming";
  const isStreaming = isReasoningStreaming || (isMessageStreaming && part.state !== "done");
  if (!shouldRenderReasoningPart(part, isMessageStreaming)) return null;

  return (
    <Reasoning isStreaming={isReasoningStreaming} defaultOpen={isStreaming}>
      <ReasoningTrigger />
      <ReasoningContent>{text}</ReasoningContent>
    </Reasoning>
  );
}
