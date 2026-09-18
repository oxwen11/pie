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
import type {
  DynamicToolUIPart,
  InferUIMessageChunk,
  ToolUIPart,
  UIDataTypes,
  UIMessage,
} from "ai";

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

// The message shapes that carry typed tool parts on the session wire (history
// reads and `session.message.chunk` events). Metadata stays loose: the server
// stamps richer PiMetadata and clients read it defensively.
export type SessionUIMessage = UIMessage<unknown, UIDataTypes, PiTools>;
export type SessionUIMessageChunk = InferUIMessageChunk<SessionUIMessage>;

/** Pi's seven static tool parts plus extension/custom dynamic tools. */
export type SessionToolPart = ToolUIPart<PiTools> | DynamicToolUIPart;
