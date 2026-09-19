import { Response } from "@getpie/ui/ai-elements/response";
import { Shimmer } from "@getpie/ui/ai-elements/shimmer";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@getpie/ui/components/collapsible";
import { Marker, MarkerContent, MarkerIcon } from "@getpie/ui/components/marker";
import { Spinner } from "@getpie/ui/components/spinner";

import type { CompactionState } from "../../runtime/chat-state";

export function CompactionStatus({ state }: { state: CompactionState }) {
  if (!state) return null;
  return (
    <Marker role="status" aria-live="polite" aria-busy={state.phase === "running"} className="my-3">
      {state.phase === "running" ? (
        <>
          <MarkerIcon>
            <Spinner role="presentation" aria-label={undefined} />
          </MarkerIcon>
          <MarkerContent>
            <Shimmer as="span">Compacting conversation…</Shimmer>
          </MarkerContent>
        </>
      ) : (
        <MarkerContent>
          {state.phase === "canceled" ? "Compaction canceled" : state.error}
        </MarkerContent>
      )}
    </Marker>
  );
}

export function CompactionMarker({ summary }: { summary: string }) {
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
        <Response>{summary}</Response>
      </CollapsibleContent>
    </Collapsible>
  );
}
