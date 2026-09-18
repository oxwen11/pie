import { CodeBlock } from "@getpie/ui/ai-elements/code-block";
import { Tool, ToolContent, ToolHeader } from "@getpie/ui/ai-elements/tool";
import type { DynamicToolUIPart } from "ai";
import { WrenchIcon } from "lucide-react";

// Generic card for `dynamic-tool` parts — extension/custom tools outside pi's
// built-in set. Their input shapes are unconstrained (any extension can feed
// them); JSON.stringify can throw on cycles — fall back to a placeholder
// instead of letting the card crash.
function serialize(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "Failed to render tool input";
  }
}

export function DynamicToolPart({ part, name }: { part: DynamicToolUIPart; name: string }) {
  const input = typeof part.input === "object" && part.input !== null ? part.input : undefined;
  return (
    <Tool>
      <ToolHeader icon={WrenchIcon}>{name}</ToolHeader>
      <ToolContent>
        {input != null && (
          <div className="space-y-1.5">
            <span className="text-muted-foreground text-xs font-medium">Input</span>
            <CodeBlock code={serialize(input)} language="json" />
          </div>
        )}
      </ToolContent>
    </Tool>
  );
}
