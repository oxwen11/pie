import type { PiTools } from "@getpie/contract";
import type { InferUIMessageChunk, UIMessage } from "ai";

import type { SessionMessageEntry } from "./protocol";

type PiAssistantHistoryMessage = Extract<SessionMessageEntry["message"], { role: "assistant" }>;

export type PiUserMetadata = {
  /** Pi session id (a uuid we assign via `--session-id`). */
  sessionId: string;
  /** JSONL entry time. Not the worked-for span. */
  timestamp?: SessionMessageEntry["timestamp"];
};

// model/usage are history-only (docs/design/pi-history-read-design.md §5).
// `messageStartTimestamp` is the first assistant message's own timestamp.
// `messageEndTimestamp` is when its last message ended: JSONL entry time on
// restore, message_end receipt on stream.
export type PiAssistantMetadata = {
  /** Pi session id (a uuid we assign via `--session-id`). */
  sessionId: string;
  messageStartTimestamp?: string;
  messageEndTimestamp?: string;
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

export type PiUserUIMessage = UIMessage<PiUserMetadata, PiDataTypes, PiTools> & {
  role: "user";
};
export type PiAssistantUIMessage = UIMessage<PiAssistantMetadata, PiDataTypes, PiTools> & {
  role: "assistant";
};
export type PiUIMessage = PiUserUIMessage | PiAssistantUIMessage;
export type PiUIMessageChunk = InferUIMessageChunk<PiUIMessage>;
