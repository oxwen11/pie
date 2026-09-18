import type { SessionToolPart } from "@getpie/contract";
import { isReasoningUIPart } from "ai";

import { BUCKET_ORDER, bucketFor, filePathOf, type BucketKey } from "./tool/bucket";
import type { BatchPart } from "./use-tool-batches";

/** Completed-tool counts per bucket. A bucket appears iff `doneCount` > 0. */
export type BucketCount = {
  key: BucketKey;
  doneCount: number;
};

export type BatchTriggerLabel =
  | { kind: "running"; action: string }
  | { kind: "aggregated"; buckets: BucketCount[] };

function isToolRunning(part: SessionToolPart): boolean {
  return part.state === "input-streaming" || part.state === "input-available";
}

function emptyIdentities() {
  return {
    files: new Set(),
    lists: new Set(),
    searches: new Set(),
    edits: new Set(),
    commands: new Set(),
  };
}

interface RunningActionMap {
  readonly [toolType: string]: { verb: string; field: string };
}

const RUNNING_ACTIONS: RunningActionMap = {
  "tool-read": { verb: "Reading", field: "path" },
  "tool-ls": { verb: "Listing", field: "path" },
  "tool-find": { verb: "Finding", field: "pattern" },
  "tool-grep": { verb: "Searching", field: "pattern" },
  "tool-edit": { verb: "Editing", field: "path" },
  "tool-write": { verb: "Writing", field: "path" },
  "tool-bash": { verb: "Running", field: "command" },
};

function isInputRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null;
}

function inputString(part: SessionToolPart, key: string): string | undefined {
  if (!isInputRecord(part.input)) return undefined;
  const value = part.input[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function runningActionOf(part: SessionToolPart): string {
  const spec = RUNNING_ACTIONS[part.type];
  if (spec) {
    const target = inputString(part, spec.field);
    return target ? `${spec.verb} ${target}` : spec.verb;
  }
  if ("toolName" in part && typeof part.toolName === "string") return part.toolName;
  return part.type.startsWith("tool-") ? part.type.slice("tool-".length) : part.type;
}

/**
 * While any tool is in flight, the trigger is that last tool's action.
 * Only when every tool has settled do we aggregate completed buckets.
 *
 * Dedup rules (completed only):
 * - `files` / `edits` dedupe by file path (fallback to `toolCallId` when the
 *   path isn't streamed yet).
 * - `lists` / `searches` / `commands` count by occurrence (per `toolCallId`).
 *
 * Reasoning parts are ignored.
 */
export function computeBatchTrigger(parts: readonly BatchPart[]): BatchTriggerLabel {
  const tools: SessionToolPart[] = [];
  let lastRunning: SessionToolPart | undefined;
  for (const part of parts) {
    if (isReasoningUIPart(part)) continue;
    tools.push(part);
    if (isToolRunning(part)) lastRunning = part;
  }
  if (lastRunning) return { kind: "running", action: runningActionOf(lastRunning) };

  const doneIdentities = emptyIdentities();
  for (const part of tools) {
    const bucket = bucketFor(part);
    if (bucket == null) continue;
    const dedupKey =
      bucket === "files" || bucket === "edits"
        ? (filePathOf(part) ?? part.toolCallId)
        : part.toolCallId;
    doneIdentities[bucket].add(dedupKey);
  }

  const buckets: BucketCount[] = BUCKET_ORDER.flatMap((key) => {
    const doneCount = doneIdentities[key].size;
    return doneCount > 0 ? [{ key, doneCount }] : [];
  });

  return { kind: "aggregated", buckets };
}
