import type { PieUIMessage } from "@getpie/contract";
import { isToolUIPart } from "ai";

type Part = PieUIMessage["parts"][number];

export function isVisibleWorkPart(part: Part): boolean {
  if (isToolUIPart(part)) return true;
  if (part.type === "reasoning") return true;
  return part.type === "text" && part.text.trim() !== "";
}

export function splitWork(
  parts: readonly Part[],
  isStreaming: boolean,
): { workParts: Part[]; answerParts: Part[] } | null {
  if (isStreaming) {
    return parts.length === 0 ? null : { workParts: [...parts], answerParts: [] };
  }

  let lastText = -1;
  for (const [index, part] of parts.entries()) {
    if (part.type === "text" && part.text.trim() !== "") lastText = index;
  }
  const workAfterLastText =
    lastText >= 0 && parts.slice(lastText + 1).some((part) => isVisibleWorkPart(part));
  if (lastText >= 0 && !workAfterLastText) {
    const workParts = parts.slice(0, lastText);
    if (!workParts.some((part) => isVisibleWorkPart(part))) return null;
    return { workParts, answerParts: parts.slice(lastText) };
  }
  if (!parts.some((part) => isVisibleWorkPart(part))) return null;
  return { workParts: [...parts], answerParts: [] };
}

export function formatWorkedFor(seconds: number): string {
  if (seconds < 60) return `Worked for ${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest === 0 ? `Worked for ${minutes}m` : `Worked for ${minutes}m ${rest}s`;
}

export function messageStartTimestampOf(metadata: unknown): string | undefined {
  if (typeof metadata !== "object" || metadata === null || !("messageStartTimestamp" in metadata)) {
    return undefined;
  }
  return typeof metadata.messageStartTimestamp === "string"
    ? metadata.messageStartTimestamp
    : undefined;
}

function messageEndTimestampOf(metadata: unknown): string | undefined {
  if (typeof metadata !== "object" || metadata === null || !("messageEndTimestamp" in metadata)) {
    return undefined;
  }
  return typeof metadata.messageEndTimestamp === "string"
    ? metadata.messageEndTimestamp
    : undefined;
}

/** Settled span: messageEndTimestamp minus messageStartTimestamp, in whole seconds. */
export function workedSeconds(metadata: unknown): number | undefined {
  const from = messageStartTimestampOf(metadata);
  const to = messageEndTimestampOf(metadata);
  if (from === undefined || to === undefined) return undefined;
  const start = Date.parse(from);
  const end = Date.parse(to);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return undefined;
  return Math.floor((end - start) / 1000);
}
