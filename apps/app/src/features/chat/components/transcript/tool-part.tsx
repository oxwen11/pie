import type { DynamicToolUIPart, ToolUIPart, UIMessage } from "ai";
import { ErrorBoundary } from "react-error-boundary";

import { DynamicToolPart } from "./tool/dynamic-tool-part";

type AnyToolPart = ToolUIPart | DynamicToolUIPart;

const genericToolName = (part: AnyToolPart): string =>
  part.type === "dynamic-tool" ? part.toolName : part.type.replace(/^tool-/, "");

// tool-* / dynamic-tool dispatch: unrecognized tools (dynamic-tool, or typed
// tools with no dedicated component) fall back to the shared DynamicToolPart.
// One malformed payload degrades to a single fallback line instead of blanking
// the whole transcript; resetKeys re-arms the boundary when the part
// transitions state.
export function ToolPart({ message: _message, part }: { message: UIMessage; part: AnyToolPart }) {
  if (part.state === "input-streaming") return null;
  return (
    <ErrorBoundary
      fallback={<div className="text-destructive text-xs">Failed to render tool output</div>}
      resetKeys={[part.type, part.toolCallId, part.state]}
    >
      <ToolPartContent part={part} />
    </ErrorBoundary>
  );
}

function ToolPartContent({ part }: { part: AnyToolPart }) {
  return <DynamicToolPart part={part} name={genericToolName(part)} />;
}
