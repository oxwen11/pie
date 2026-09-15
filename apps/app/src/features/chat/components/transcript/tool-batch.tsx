import { Shimmer } from "@getpie/ui/ai-elements/shimmer";
import { Tool, ToolHeader } from "@getpie/ui/ai-elements/tool";
import { CollapsibleContent } from "@getpie/ui/components/collapsible";
import { ChevronDownIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { computeBatchTrigger, type BatchTriggerLabel } from "./compute-batch-trigger";
import { ReasoningPart } from "./reasoning-part";
import { ToolPart } from "./tool-part";
import type { BucketKey } from "./tool/bucket";
import type { IndexedBatchPart } from "./use-tool-batches";

const BUCKET_PHRASES = {
  files: (n) => `Read ${n} ${plural(n, "file")}`,
  lists: (n) => `Listed ${n} ${plural(n, "directory", "directories")}`,
  searches: (n) => `Ran ${n} ${plural(n, "search", "searches")}`,
  edits: (n) => `Edited ${n} ${plural(n, "file")}`,
  commands: (n) => `Ran ${n} ${plural(n, "command")}`,
} satisfies Record<BucketKey, (count: number) => string>;

function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return count === 1 ? singular : pluralForm;
}

function buildTriggerPhrase(label: BatchTriggerLabel): string {
  if (label.kind === "running") return label.action;
  if (label.buckets.length === 0) return "Tool calls";
  return label.buckets.map((bucket) => BUCKET_PHRASES[bucket.key](bucket.doneCount)).join(", ");
}

// Closed by default. shouldShimmer only drives the trigger shimmer — computed
// by the parent from `isTrailing && isStreaming`. Chrome matches ToolHeader
// (size-4 icon, py-1, gap-2) so batches line up with standalone tools.
export function ToolBatch({
  parts,
  shouldShimmer = false,
  className,
}: {
  parts: IndexedBatchPart[];
  shouldShimmer?: boolean;
  className?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const batchParts = useMemo(() => parts.map((p) => p.part), [parts]);
  const label = useMemo(() => computeBatchTrigger(batchParts), [batchParts]);
  const phrase = useMemo(() => buildTriggerPhrase(label), [label]);

  return (
    <Tool open={isOpen} onOpenChange={setIsOpen} className={className}>
      <ToolHeader icon={ChevronDownIcon}>
        {shouldShimmer ? (
          <Shimmer duration={2} as="span">
            {phrase}
          </Shimmer>
        ) : (
          phrase
        )}
      </ToolHeader>
      <CollapsibleContent className="mt-2 flex flex-col">
        {parts.map(({ part, index }) => {
          if (part.type === "reasoning") {
            return (
              <ReasoningPart
                key={part.id ?? `reasoning-${index}`}
                part={part}
                isMessageStreaming={shouldShimmer}
              />
            );
          }
          return <ToolPart key={part.toolCallId} part={part} />;
        })}
      </CollapsibleContent>
    </Tool>
  );
}
