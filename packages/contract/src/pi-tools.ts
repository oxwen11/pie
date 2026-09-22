import type {
  AgentToolResult,
  BashToolDetails,
  BashToolInput,
  EditToolDetails,
  EditToolInput,
  FindToolDetails,
  FindToolInput,
  GrepToolDetails,
  GrepToolInput,
  LsToolDetails,
  LsToolInput,
  ReadToolDetails,
  ReadToolInput,
  WriteToolInput,
} from "@earendil-works/pi-coding-agent";
import type { DynamicToolUIPart, InferUIMessageChunk, ToolUIPart, UIMessage } from "ai";

type ReadToolOutput = Omit<
  AgentToolResult<
    | (Omit<ReadToolDetails, "truncation"> & {
        truncation?: Omit<NonNullable<ReadToolDetails["truncation"]>, "content">;
      })
    | undefined
  >,
  "content"
> & { content: [] };

// Pi's built-in tools as AI SDK UI tools. Keys are pi's lowercase wire names;
// UIMessage prefixes them with `tool-` in static tool parts. The server's
// runtime registry is type-tested against this wire vocabulary.
export type PiTools = {
  read: { input: ReadToolInput; output: ReadToolOutput };
  bash: { input: BashToolInput; output: AgentToolResult<BashToolDetails> };
  edit: { input: EditToolInput; output: AgentToolResult<EditToolDetails> };
  write: { input: WriteToolInput; output: AgentToolResult<undefined> };
  grep: { input: GrepToolInput; output: AgentToolResult<GrepToolDetails> };
  find: { input: FindToolInput; output: AgentToolResult<FindToolDetails> };
  ls: { input: LsToolInput; output: AgentToolResult<LsToolDetails> };
};

export type PieUserMetadata = {
  /** Pi session id (a uuid we assign via `--session-id`). */
  sessionId: string;
  /** JSONL entry time. Not the worked-for span. */
  timestamp?: string;
};

export type PieAssistantMetadata = {
  /** Pi session id (a uuid we assign via `--session-id`). */
  sessionId: string;
  messageStartTimestamp?: string;
  messageEndTimestamp?: string;
};

// SDK default `UIDataTypes` is `Record<string, unknown>`.
export type PieDataTypes = {
  compaction:
    | { phase: "running" }
    | { phase: "completed"; summary: string }
    | { phase: "canceled" }
    | { phase: "failed"; error: string };
  retry: {
    errorMessage: string;
    attempt?: number;
    maxAttempts?: number;
  };
  inspector: ReadonlyArray<{
    file: string;
    line: number;
    column: number;
  }>;
};

export type PieUserUIMessage = UIMessage<PieUserMetadata, PieDataTypes, PiTools> & {
  role: "user";
};
export type PieAssistantUIMessage = UIMessage<PieAssistantMetadata, PieDataTypes, PiTools> & {
  role: "assistant";
};
export type PieUIMessage = PieUserUIMessage | PieAssistantUIMessage;
export type PieUIMessageChunk = InferUIMessageChunk<PieUIMessage>;

/** Pi's seven static tool parts plus extension/custom dynamic tools. */
export type PieToolUIPart = ToolUIPart<PiTools> | DynamicToolUIPart;
