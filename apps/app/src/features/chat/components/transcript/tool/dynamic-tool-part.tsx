import { CodeBlock } from "@getpie/ui/ai-elements/code-block";
import { Tool, ToolContent, ToolHeader } from "@getpie/ui/ai-elements/tool";
import type { DynamicToolUIPart, ToolUIPart } from "ai";
import { WrenchIcon } from "lucide-react";

type AnyToolPart = ToolUIPart | DynamicToolUIPart;
type ToolResultBlock =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mediaType: string };

type ToolImageResult = {
  blocks: ToolResultBlock[];
  remainder: Record<string, unknown> | null;
};

const RASTER_IMAGE_MEDIA_TYPES = new Set([
  "image/bmp",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

// dynamic-tool input/output shapes are unconstrained (any MCP server can feed
// them); JSON.stringify can throw on cycles — fall back to a placeholder
// instead of letting the card crash.
function serialize(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "Failed to render tool output";
  }
}

function toolImageResult(value: unknown): ToolImageResult | null {
  if (typeof value !== "object" || value === null) return null;
  const output = value as Record<string, unknown>;
  if (!Array.isArray(output.content)) return null;

  const blocks: ToolResultBlock[] = [];
  const remainingContent: unknown[] = [];
  let hasImage = false;
  for (const block of output.content) {
    if (typeof block !== "object" || block === null) {
      remainingContent.push(block);
      continue;
    }
    const candidate = block as Record<string, unknown>;
    if (candidate.type === "text" && typeof candidate.text === "string") {
      blocks.push({ type: "text", text: candidate.text });
    } else if (
      candidate.type === "image" &&
      typeof candidate.data === "string" &&
      typeof candidate.mimeType === "string" &&
      RASTER_IMAGE_MEDIA_TYPES.has(candidate.mimeType)
    ) {
      blocks.push({ type: "image", data: candidate.data, mediaType: candidate.mimeType });
      hasImage = true;
    } else {
      remainingContent.push(block);
    }
  }

  if (!hasImage) return null;
  const remainder = Object.fromEntries(Object.entries(output).filter(([key]) => key !== "content"));
  if (remainingContent.length > 0) remainder.content = remainingContent;
  return {
    blocks,
    remainder: Object.keys(remainder).length > 0 ? remainder : null,
  };
}

// Fallback tool card for any tool-* / dynamic-tool part with no dedicated
// component (unknown MCP tools). Purely presentational and name-agnostic —
// `name` is injected by the caller; provider-specific display-name derivation
// stays in each provider dir.
export function DynamicToolPart({ part, name }: { part: AnyToolPart; name: string }) {
  const input = part.input as Record<string, unknown> | undefined;
  const imageResult = toolImageResult(part.output);
  return (
    <Tool key={imageResult === null ? "default" : "image"} defaultOpen={imageResult !== null}>
      <ToolHeader icon={WrenchIcon}>{name}</ToolHeader>
      <ToolContent>
        {input != null && (
          <div className="space-y-1.5">
            <span className="text-muted-foreground text-xs font-medium">Input</span>
            <CodeBlock code={serialize(input)} language="json" />
          </div>
        )}
        {part.output != null && (
          <div className="space-y-1.5">
            <span className="text-muted-foreground text-xs font-medium">Output</span>
            {imageResult === null ? (
              <CodeBlock code={serialize(part.output)} language="json" />
            ) : (
              <ImageToolOutput result={imageResult} name={name} />
            )}
          </div>
        )}
      </ToolContent>
    </Tool>
  );
}

function ImageToolOutput({ result, name }: { result: ToolImageResult; name: string }) {
  return (
    <div data-slot="tool-image-output" className="space-y-2">
      {result.blocks.map((block, index) =>
        block.type === "text" ? (
          // Tool-result content is immutable and has no block ids, so its
          // position is the only stable identity available.
          // react-doctor-disable-next-line no-array-index-as-key
          <div key={index} className="text-muted-foreground text-xs whitespace-pre-wrap">
            {block.text}
          </div>
        ) : (
          // Tool-result content is immutable and has no block ids, so its
          // position is the only stable identity available.
          // react-doctor-disable-next-line no-array-index-as-key
          <img
            key={index}
            alt={`${name} tool output`}
            className="max-h-[32rem] max-w-full rounded-md object-contain"
            decoding="async"
            loading="lazy"
            src={`data:${block.mediaType};base64,${block.data}`}
          />
        ),
      )}
      {result.remainder != null && (
        <div data-slot="tool-output-remainder">
          <CodeBlock code={serialize(result.remainder)} language="json" />
        </div>
      )}
    </div>
  );
}
