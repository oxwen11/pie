import type { PieToolUIPart } from "@getpie/contract";

// The five aggregation buckets. Order here is the order rendered in the
// trigger phrase (files → lists → searches → edits → commands).
export type BucketKey = "files" | "lists" | "searches" | "edits" | "commands";

export const BUCKET_ORDER: readonly BucketKey[] = [
  "files",
  "lists",
  "searches",
  "edits",
  "commands",
] as const;

// `part.type` → bucket, keyed by the AI-SDK tool-part type string. Covers
// pi's built-in tools (contract piTools); extension tools arrive as
// `dynamic-tool` and stay silent in the trigger phrase while still entering
// the accordion (see use-tool-batches).
interface ToolBucketMap {
  readonly [toolType: string]: BucketKey;
}

const TOOL_BUCKETS: ToolBucketMap = {
  "tool-read": "files",
  "tool-ls": "lists",
  "tool-find": "lists",
  "tool-grep": "searches",
  "tool-edit": "edits",
  "tool-write": "edits",
  "tool-bash": "commands",
};

export function bucketFor(part: PieToolUIPart): BucketKey | null {
  return TOOL_BUCKETS[part.type] ?? null;
}

// The file identity a `files`/`edits` tool dedupes on. Typed off the wire
// generic — `input` is `DeepPartial` while streaming, hence the optional chain.
export function filePathOf(part: PieToolUIPart): string | undefined {
  switch (part.type) {
    case "tool-read":
    case "tool-edit":
    case "tool-write":
      return part.input?.path;
    default:
      return undefined;
  }
}
