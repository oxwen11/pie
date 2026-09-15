import type { InferUIMessageChunk, UIMessage } from "ai";

import type { SessionMessageEntry } from "./protocol";
import type { PiTools } from "./tools";

type PiAssistantHistoryMessage = Extract<SessionMessageEntry["message"], { role: "assistant" }>;

export type PiMetadata = {
  /** Pi session id (a uuid we assign via `--session-id`). */
  sessionId: string;
  // History enrichment: only messages folded from disk carry these — the live
  // stream never surfaces usage/model, so live/history metadata is asymmetric
  // by design (docs/design/pi-history-read-design.md §5). Values come from the
  // segment's last assistant entry; `usage.cost` carries the cost breakdown.
  model?: PiAssistantHistoryMessage["model"];
  provider?: PiAssistantHistoryMessage["provider"];
  stopReason?: PiAssistantHistoryMessage["stopReason"];
  usage?: PiAssistantHistoryMessage["usage"];
};

// Retry is transient UI status, not transcript. Compaction lifecycle stays
// off the chunk track; its history marker is a settled data part. The queue is a session
// event (`session.queue.updated`), not a UI-message data part.
export type PiDataTypes = {
  compaction: { summary: string };
  retry: {
    errorMessage: string;
    attempt?: number;
    maxAttempts?: number;
  };
};

export type PiUIMessage = UIMessage<PiMetadata, PiDataTypes, PiTools>;
export type PiUIMessageChunk = InferUIMessageChunk<PiUIMessage>;
