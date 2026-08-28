/**
 * Label for a reasoning block trigger.
 *
 * Duration is never inferred. Pi's thinking blocks and thinking_* events
 * do not carry elapsed time (`usage.reasoning` is a token count). Callers
 * that have a real duration may pass it; otherwise the settled label is
 * just "Thought".
 */
export function thinkingTriggerLabel(isStreaming: boolean, duration: number | undefined): string {
  if (isStreaming) return "Thinking...";
  if (duration !== undefined && duration >= 1) {
    return `Thought for ${duration} ${duration === 1 ? "second" : "seconds"}`;
  }
  return "Thought";
}
