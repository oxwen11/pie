/** Label for a reasoning block trigger. Streaming is the only "still thinking" signal. */
export function thinkingTriggerLabel(isStreaming: boolean, duration: number | undefined): string {
  if (isStreaming) return "Thinking...";
  if (duration === undefined || duration < 1) return "Thought for a few seconds";
  return `Thought for ${duration} ${duration === 1 ? "second" : "seconds"}`;
}
