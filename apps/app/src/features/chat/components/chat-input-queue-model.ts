import type { SessionPendingPrompt } from "@getpie/contract";

export type QueuedPromptKind = "steering" | "followUp";

export function replaceQueuedItem(
  pending: SessionPendingPrompt,
  kind: QueuedPromptKind,
  index: number,
  text: string,
): SessionPendingPrompt {
  const items = pending[kind];
  if (index < 0 || index >= items.length) return pending;
  const next = items.slice();
  next[index] = text;
  return { ...pending, [kind]: next };
}

export function removeQueuedItem(
  pending: SessionPendingPrompt,
  kind: QueuedPromptKind,
  index: number,
): SessionPendingPrompt {
  const items = pending[kind];
  if (index < 0 || index >= items.length) return pending;
  return { ...pending, [kind]: items.filter((_, itemIndex) => itemIndex !== index) };
}

export function promoteQueuedFollowUp(
  pending: SessionPendingPrompt,
  index: number,
): SessionPendingPrompt {
  const items = pending.followUp;
  if (index < 0 || index >= items.length) return pending;
  const text = items[index]!;
  return {
    steering: [...pending.steering, text],
    followUp: items.filter((_, itemIndex) => itemIndex !== index),
  };
}

export function queuedPromptKey(
  kind: QueuedPromptKind,
  items: readonly string[],
  position: number,
): string {
  const text = items[position] ?? "";
  const seen = items.slice(0, position).filter((item) => item === text).length;
  return `${kind}:${text}:${String(seen)}`;
}
