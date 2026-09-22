import type {
  PieAssistantMetadata,
  PieDataTypes,
  PieUserMetadata,
  PiTools,
} from "@getpie/contract";
import type { InferUIMessageChunk, UIMessage } from "ai";

import type { SessionMessageEntry } from "./protocol";

type PiAssistantHistoryMessage = Extract<SessionMessageEntry["message"], { role: "assistant" }>;

// model/usage are history-only (docs/design/pi-history-read-design.md §5).
export type PiAssistantMetadata = PieAssistantMetadata & {
  model?: PiAssistantHistoryMessage["model"];
  provider?: PiAssistantHistoryMessage["provider"];
  stopReason?: PiAssistantHistoryMessage["stopReason"];
  usage?: PiAssistantHistoryMessage["usage"];
};

export type PiUserUIMessage = UIMessage<PieUserMetadata, PieDataTypes, PiTools> & {
  role: "user";
};
export type PiAssistantUIMessage = UIMessage<PiAssistantMetadata, PieDataTypes, PiTools> & {
  role: "assistant";
};
export type PiUIMessage = PiUserUIMessage | PiAssistantUIMessage;
export type PiUIMessageChunk = InferUIMessageChunk<PiUIMessage>;
