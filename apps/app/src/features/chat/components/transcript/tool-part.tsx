import type { PiTools } from "@getpie/contract";
import type { DynamicToolUIPart, ToolUIPart } from "ai";
import {
  FilePenIcon,
  FilePlusIcon,
  FileSearchIcon,
  FileTextIcon,
  FolderIcon,
  SearchIcon,
  TerminalIcon,
  type LucideIcon,
} from "lucide-react";
import { ErrorBoundary } from "react-error-boundary";

import { DynamicToolPart } from "./tool/dynamic-tool-part";
import { ToolLine } from "./tool/tool-line";

// Tool parts typed by the wire generic (UIMessage<…, PiTools>): the switch
// narrows both `type` and `input`, so each case reads its typed input with no
// casts. Extension/custom tools travel as `dynamic-tool` parts.
type AnyToolPart = ToolUIPart<PiTools> | DynamicToolUIPart;

// One switch case per pi built-in, its rendering inline in the case, shared
// components (ToolLine, DynamicToolPart) reused across cases. One malformed
// payload degrades to a single fallback line instead of blanking the whole
// transcript; resetKeys re-arms the boundary when the part transitions state.
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

function toolLine(icon: LucideIcon, name: string, detail?: string) {
  return <ToolLine icon={icon}>{detail == null ? name : `${name} ${detail}`}</ToolLine>;
}

function ToolPartContent({ part }: { part: AnyToolPart }) {
  switch (part.type) {
    case "tool-read":
      return toolLine(FileTextIcon, "read", part.input?.path);
    case "tool-edit":
      return toolLine(FilePenIcon, "edit", part.input?.path);
    case "tool-write":
      return toolLine(FilePlusIcon, "write", part.input?.path);
    case "tool-bash":
      return toolLine(TerminalIcon, "bash", part.input?.command);
    case "tool-grep":
      return toolLine(SearchIcon, "grep", part.input?.pattern);
    case "tool-find":
      return toolLine(FileSearchIcon, "find", part.input?.pattern);
    case "tool-ls":
      return toolLine(FolderIcon, "ls", part.input?.path);
    // Extension / custom tools
    default:
      return <DynamicToolPart part={part} name={part.toolName} />;
  }
}
