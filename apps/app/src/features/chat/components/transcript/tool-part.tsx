import type { DynamicToolUIPart, ToolUIPart } from "ai";
import { FileTextIcon } from "lucide-react";
import { ErrorBoundary } from "react-error-boundary";

import { filePathOf } from "./tool/bucket";
import { DynamicToolPart } from "./tool/dynamic-tool-part";

type AnyToolPart = ToolUIPart | DynamicToolUIPart;

const genericToolName = (part: AnyToolPart): string =>
  part.type === "dynamic-tool" ? part.toolName : part.type.replace(/^tool-/, "");

// tool-* / dynamic-tool dispatch: unrecognized tools (dynamic-tool, or typed
// tools with no dedicated component) fall back to the shared DynamicToolPart.
// One malformed payload degrades to a single fallback line instead of blanking
// the whole transcript; resetKeys re-arms the boundary when the part
// transitions state.
export function ToolPart({ part }: { part: AnyToolPart }) {
  if (part.state === "input-streaming") return null;
  return (
    <ErrorBoundary
      fallback={<div className="text-destructive text-xs">Failed to render tool call</div>}
      resetKeys={[part.type, part.toolCallId, part.state]}
    >
      <ToolPartContent part={part} />
    </ErrorBoundary>
  );
}

function ToolPartContent({ part }: { part: AnyToolPart }) {
  const name = genericToolName(part);
  if (part.type === "tool-read" || part.type === "tool-Read") {
    const path = filePathOf(part);
    return (
      <div className="text-muted-foreground flex w-full items-center gap-2 overflow-hidden py-1">
        <FileTextIcon className="size-4 shrink-0" />
        <span className="truncate text-sm">{path == null ? name : `${name} ${path}`}</span>
      </div>
    );
  }
  return <DynamicToolPart part={part} name={name} />;
}
