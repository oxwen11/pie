import { v7 as uuid } from "uuid";

import type { SessionEvent } from "../events/framework";
import type { AgentSessionEvent } from "./protocol";
import { adaptPiToolResult } from "./tool-result";
import { isDynamicPiTool } from "./tools";
import type { PiUIMessageChunk } from "./ui-message";

type PiPromptSubmitted = Extract<SessionEvent, { type: "session.prompt.submitted" }>;
type PiUserMessage = Extract<
  Extract<AgentSessionEvent, { type: "message_start" }>["message"],
  { role: "user" }
>;

export type PiStreamItem = PiUIMessageChunk | PiPromptSubmitted;

// Pi RPC event → UI-chunk transform, the pi analog of createCodexTransform.
// Same house generator-factory style: call once per session; the returned
// generator holds its open-turn state in closure variables.
//
// Pi streams one *run* per prompt (`agent_start` → deltas → `agent_settled`,
// with retries/compaction folded into the same run):
//   • message_update deltas → text-* / reasoning-* (ids are `m<msg>.<block>`;
//     pi content indexes restart per assistant message, so blocks are scoped
//     by a per-run message ordinal, advanced on `message_start role=assistant`
//     — the only per-message marker RPC mode actually emits; the
//     assistantMessageEvent `start` delta never appears on this wire)
//   • a `message_start role=user` after assistant output is a delivered steer
//     (pi injects it as a real user entry — see ADR 0003): close the open
//     assistant UIMessage, emit the existing prompt-submitted event for the
//     user UIMessage, then start a fresh assistant UIMessage. The echo of the
//     *prompting* input arrives before any assistant message and is skipped.
//   • tool_execution_start/end → tool-input-available + tool-output-available.
//     Successful read text is dropped because the UI only renders the input
//     path; raster images still become AI SDK file parts.
//   • message_end / compaction / auto_retry_end → skipped
//   • willRetry / auto_retry_start → transient `data-retry` (UI status, not
//     transcript)
//   • queue_update → skipped here; the process offers it on `queueUpdates`
//     and the runtime emits `session.queue.updated`
//   • agent_start/agent_settled → `start`/`finish`; a retry re-emits
//     agent_start, so `start` is guarded to fire once per turn.

/** A tool result's display text: the concatenated text blocks of its content. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function toolResultText(result: unknown): string {
  const content = isRecord(result) ? result.content : undefined;
  if (!Array.isArray(content)) return "";
  return content
    .filter(
      (block): block is { type: "text"; text: string } =>
        isRecord(block) && block.type === "text" && typeof block.text === "string",
    )
    .map((block) => block.text)
    .join("\n");
}

export function stripReadDetailsContent(details: unknown) {
  if (!isRecord(details) || !isRecord(details.truncation)) return details;
  const { content: _content, ...truncation } = details.truncation;
  return { ...details, truncation };
}

/** Per-session render transform factory: one `createPiTransform()` call per session. */
function promptParts(message: PiUserMessage): PiPromptSubmitted["parts"] {
  if (typeof message.content === "string") return [{ type: "text", text: message.content }];
  return message.content.map((block) =>
    block.type === "text"
      ? { type: "text" as const, text: block.text }
      : {
          type: "file" as const,
          mediaType: block.mimeType,
          url: `data:${block.mimeType};base64,${block.data}`,
        },
  );
}

export function createPiTransform(
  sessionId: string,
): (event: AgentSessionEvent) => Generator<PiStreamItem> {
  let turnOpen = false;
  // Ordinal of the assistant message within the run; pi's contentIndex restarts
  // per message, so block ids need both to stay unique inside one UIMessage.
  // Doubles as "has this run produced assistant output yet" (> 0), which is
  // what tells a delivered steer apart from the prompting input's echo.
  let messageOrdinal = 0;
  // A steered user message landed mid-run. The next assistant message needs a
  // fresh start; if the run settles first, no empty assistant message is emitted.
  let pendingAssistantStart = false;
  // Block ids that streamed at least one delta, so *_end can recover text that
  // only arrived whole (the no-delta fallback, mirroring codex).
  const streamedBlocks = new Set<string>();

  const blockId = (contentIndex: number) => `m${messageOrdinal}.${contentIndex}`;

  function* onAssistantDelta(
    event: Extract<AgentSessionEvent, { type: "message_update" }>,
  ): Generator<PiStreamItem> {
    const delta = event.assistantMessageEvent;
    switch (delta.type) {
      case "text_start":
        yield { type: "text-start", id: blockId(delta.contentIndex) };
        break;
      case "text_delta": {
        const id = blockId(delta.contentIndex);
        streamedBlocks.add(id);
        yield { type: "text-delta", id, delta: delta.delta };
        break;
      }
      case "text_end": {
        const id = blockId(delta.contentIndex);
        if (!streamedBlocks.delete(id) && delta.content) {
          yield { type: "text-delta", id, delta: delta.content };
        }
        yield { type: "text-end", id };
        break;
      }
      case "thinking_start":
        yield { type: "reasoning-start", id: blockId(delta.contentIndex) };
        break;
      case "thinking_delta": {
        const id = blockId(delta.contentIndex);
        streamedBlocks.add(id);
        yield { type: "reasoning-delta", id, delta: delta.delta };
        break;
      }
      case "thinking_end": {
        const id = blockId(delta.contentIndex);
        if (!streamedBlocks.delete(id) && delta.content) {
          yield { type: "reasoning-delta", id, delta: delta.content };
        }
        yield { type: "reasoning-end", id };
        break;
      }
      // toolcall_* deltas are skipped: tool_execution_start carries the full
      // args, and the AI-SDK has no incremental tool-output track anyway.
      // done/error are folded into message_end / agent_end.
    }
  }

  return function* transform(event: AgentSessionEvent): Generator<PiStreamItem> {
    switch (event.type) {
      case "agent_start":
        // Retries re-enter the run loop; the turn's UIMessage opens only once.
        if (!turnOpen) {
          turnOpen = true;
          messageOrdinal = 0;
          pendingAssistantStart = false;
          yield { type: "start", messageId: uuid(), messageMetadata: { sessionId } };
        }
        break;

      case "message_start":
        if (!turnOpen) break;
        if (event.message.role === "assistant") {
          if (pendingAssistantStart) {
            pendingAssistantStart = false;
            yield { type: "start", messageId: uuid(), messageMetadata: { sessionId } };
          }
          messageOrdinal += 1;
        } else if (event.message.role === "user" && messageOrdinal > 0) {
          if (!pendingAssistantStart) yield { type: "finish" };
          pendingAssistantStart = true;
          yield {
            type: "session.prompt.submitted",
            sessionId,
            messageId: uuid(),
            parts: promptParts(event.message),
          };
        }
        break;

      case "message_update":
        yield* onAssistantDelta(event);
        break;

      case "tool_execution_start":
        yield {
          type: "tool-input-available",
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          input: event.args,
          providerExecuted: true,
          dynamic: isDynamicPiTool(event.toolName),
        };
        break;

      case "tool_execution_end": {
        if (event.isError) {
          yield {
            type: "tool-output-error",
            toolCallId: event.toolCallId,
            errorText: toolResultText(event.result) || "Tool execution failed",
            providerExecuted: true,
            dynamic: isDynamicPiTool(event.toolName),
          };
        } else {
          const { output: adapted, files } = adaptPiToolResult(event.result);
          const output =
            event.toolName === "read"
              ? {
                  ...adapted,
                  content: [],
                  details: stripReadDetailsContent(adapted.details),
                }
              : adapted;
          yield {
            type: "tool-output-available",
            toolCallId: event.toolCallId,
            output,
            providerExecuted: true,
            dynamic: isDynamicPiTool(event.toolName),
          };
          yield* files;
        }
        break;
      }

      case "agent_end": {
        // A model-level failure surfaces as the run's last assistant message
        // with stopReason "error". willRetry keeps the turn open (the retry
        // events follow): emit a transient retry chunk so the UI can show it,
        // and only a terminal failure becomes an error chunk. The finish
        // always comes from agent_settled.
        const last = event.messages.at(-1);
        if (last?.role === "assistant" && last.stopReason === "error") {
          const errorMessage = last.errorMessage ?? "Pi run failed";
          if (event.willRetry) {
            yield { type: "data-retry", transient: true, data: { errorMessage } };
          } else {
            yield { type: "error", errorText: errorMessage };
          }
        }
        break;
      }

      case "auto_retry_start":
        yield {
          type: "data-retry",
          transient: true,
          data: {
            errorMessage: event.errorMessage,
            attempt: event.attempt,
            maxAttempts: event.maxAttempts,
          },
        };
        break;

      case "agent_settled":
        if (turnOpen) {
          turnOpen = false;
          if (!pendingAssistantStart) yield { type: "finish" };
          pendingAssistantStart = false;
          streamedBlocks.clear();
        }
        break;

      // Everything else is bookkeeping, an echo of our own input, or a payload
      // with no `data-*` part on the chunk track. The satisfies keeps the
      // skip-list explicit: a new AgentSessionEvent arm fails typecheck until
      // it's routed or listed.
      default:
        void (event.type satisfies
          | "message_end"
          | "tool_execution_update"
          | "turn_start"
          | "turn_end"
          | "entry_appended"
          | "session_info_changed"
          | "thinking_level_changed"
          | "compaction_start"
          | "compaction_end"
          | "auto_retry_end"
          | "summarization_retry_scheduled"
          | "summarization_retry_attempt_start"
          | "summarization_retry_finished"
          | "bash_execution_update"
          | "queue_update");
    }
  };
}
