import type { PiTools } from "@getpie/contract";
import type { InferUIMessageChunk, UIMessage } from "ai";

import type { SessionMessageEntry } from "./protocol";

type PiAssistantHistoryMessage = Extract<SessionMessageEntry["message"], { role: "assistant" }>;

export type PiMetadata = {
  /** Pi session id (a uuid we assign via `--session-id`). */
  sessionId: string;
  // History enrichment: only messages folded from disk carry model/usage — the
  // live stream never surfaces those, so live/history metadata is asymmetric
  // by design (docs/design/pi-history-read-design.md §5). On an assistant segment,
  // `messageStartTimestamp` is the first message's own timestamp and
  // `messageEndTimestamp` is when its last message ended: the JSONL entry time
  // on restore, message_end receipt on stream. `timestamp` is the user entry
  // time and is not the worked-for span.
  messageStartTimestamp?: string;
  messageEndTimestamp?: string;
  timestamp?: SessionMessageEntry["timestamp"];
  model?: PiAssistantHistoryMessage["model"];
  provider?: PiAssistantHistoryMessage["provider"];
  stopReason?: PiAssistantHistoryMessage["stopReason"];
  usage?: PiAssistantHistoryMessage["usage"];
};

// Retry is transient UI status, not transcript. Compaction and assistant
// summaries stay off the chunk track. Pi's message queue is a session
// event (`session.queue.updated`), not a UI-message data part.
export type PiDataTypes = {
  retry: {
    errorMessage: string;
    attempt?: number;
    maxAttempts?: number;
  };
};

export type PiUIMessage = UIMessage<PiMetadata, PiDataTypes, PiTools>;
export type PiUIMessageChunk = InferUIMessageChunk<PiUIMessage>;
