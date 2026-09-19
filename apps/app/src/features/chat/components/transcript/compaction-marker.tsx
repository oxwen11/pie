import { Response } from "@getpie/ui/ai-elements/response";
import { Shimmer } from "@getpie/ui/ai-elements/shimmer";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@getpie/ui/components/collapsible";
import { Marker, MarkerContent, MarkerIcon } from "@getpie/ui/components/marker";
import { Spinner } from "@getpie/ui/components/spinner";

import type { CompactionPartData } from "@/features/chat/runtime/chat";

export function isCompactionData(data: unknown): data is CompactionPartData {
  if (typeof data !== "object" || data === null || !("phase" in data)) return false;
  return (
    data.phase === "running" ||
    data.phase === "canceled" ||
    (data.phase === "completed" && "summary" in data) ||
    (data.phase === "failed" && "error" in data)
  );
}

export function CompactionMarker({ data }: { data: CompactionPartData }) {
  if (data.phase === "running") {
    return (
      <Marker role="status" aria-live="polite" aria-busy className="my-3">
        <MarkerIcon>
          <Spinner role="presentation" aria-label={undefined} />
        </MarkerIcon>
        <MarkerContent>
          <Shimmer as="span">Compacting conversation…</Shimmer>
        </MarkerContent>
      </Marker>
    );
  }
  if (data.phase === "canceled" || data.phase === "failed") {
    return (
      <Marker role="status" aria-live="polite" className="my-3">
        <MarkerContent>
          {data.phase === "canceled" ? "Compaction canceled" : data.error}
        </MarkerContent>
      </Marker>
    );
  }
  return (
    <Collapsible className="my-6">
      <Marker variant="separator">
        <MarkerContent>Conversation compacted</MarkerContent>
      </Marker>
      <div className="flex justify-center">
        <CollapsibleTrigger className="text-muted-foreground hover:text-foreground focus-visible:ring-ring min-h-11 cursor-pointer rounded-sm px-2 text-xs underline underline-offset-4 focus-visible:ring-2 focus-visible:outline-none">
          View summary
        </CollapsibleTrigger>
      </div>
      <CollapsibleContent className="mt-2 text-sm">
        <Response>{data.summary}</Response>
      </CollapsibleContent>
    </Collapsible>
  );
}
