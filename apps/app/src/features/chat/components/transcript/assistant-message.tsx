import type { PieUIMessage } from "@getpie/contract";
import { Action, Actions } from "@getpie/ui/ai-elements/actions";
import { Message, MessageContent } from "@getpie/ui/ai-elements/message";
import { Response } from "@getpie/ui/ai-elements/response";
import { isReasoningUIPart, isToolUIPart, type FileUIPart } from "ai";
import { CheckIcon, CopyIcon } from "lucide-react";
import { useState } from "react";

import { ChatImagePreview } from "./chat-image-preview";
import { CHAT_MARKDOWN_REMARK_PLUGINS } from "./chat-markdown";
import { ChatMarkdownImage } from "./chat-markdown-image";
import { ReasoningPart } from "./reasoning-part";
import { ToolBatch } from "./tool-batch";
import { ToolPart } from "./tool-part";
import { useToolBatches } from "./use-tool-batches";

type Part = PieUIMessage["parts"][number];

const RASTER_IMAGE_MEDIA_TYPES = new Set([
  "image/bmp",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

// Renders an assistant turn's parts: tool/reasoning runs as collapsible
// batches and text as markdown. The copy action only appears on the last text
// once streaming has settled.
export function AssistantMessage({
  parts,
  isStreaming,
  showActions = true,
}: {
  parts: readonly Part[];
  isStreaming: boolean;
  showActions?: boolean;
}) {
  const items = useToolBatches(parts);
  const lastTextIndex = parts.reduce(
    (last, part, index) => (part.type === "text" ? index : last),
    -1,
  );
  return (
    <>
      {items.map((item) => {
        if (item.kind === "tool-batch") {
          return (
            <div key={`batch-${item.parts[0]?.index ?? 0}`} className="py-0.5">
              <ToolBatch parts={item.parts} shouldShimmer={isStreaming && item.isTrailing} />
            </div>
          );
        }
        const { part, index } = item;
        if (isToolUIPart(part)) {
          return <ToolPart key={part.toolCallId} part={part} />;
        }
        if (isReasoningUIPart(part)) {
          return (
            <ReasoningPart
              key={part.id ?? `reasoning-${index}`}
              part={part}
              isMessageStreaming={isStreaming}
            />
          );
        }
        if (part.type === "text") {
          const canShowActions =
            showActions && !isStreaming && index === lastTextIndex && !!part.text.trim();
          return (
            <Message key={index} from="assistant">
              <MessageContent>
                <Response
                  components={{ img: ChatMarkdownImage }}
                  isAnimating={isStreaming && index === lastTextIndex}
                  remarkPlugins={CHAT_MARKDOWN_REMARK_PLUGINS}
                >
                  {part.text}
                </Response>
                {canShowActions && <CopyMarkdownButton text={part.text} />}
              </MessageContent>
            </Message>
          );
        }
        if (part.type === "file" && RASTER_IMAGE_MEDIA_TYPES.has(part.mediaType)) {
          return <AssistantImage key={index} part={part} />;
        }
        return null;
      })}
    </>
  );
}

function AssistantImage({ part }: { part: FileUIPart }) {
  return (
    <Message from="assistant">
      <MessageContent>
        <ChatImagePreview
          alt={part.filename ?? "Tool output image"}
          decoding="async"
          height={1024}
          loading="lazy"
          src={part.url}
          width={1024}
        />
      </MessageContent>
    </Message>
  );
}

function CopyMarkdownButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Actions>
      <Action
        tooltip={copied ? "Copied" : "Copy"}
        onClick={() => {
          void navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }}
      >
        {copied ? <CheckIcon className="size-4" /> : <CopyIcon className="size-4" />}
      </Action>
    </Actions>
  );
}
