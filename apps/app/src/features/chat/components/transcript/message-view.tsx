import type { PieAssistantMetadata, PieAssistantUIMessage, PieUIMessage } from "@getpie/contract";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@getpie/ui/components/collapsible";
import { SquareMinusIcon, SquarePlusIcon, TimerIcon } from "lucide-react";
import { useCallback, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { AssistantMessage } from "./assistant-message";
import { UserMessage } from "./user-message";
import { formatWorkedFor, splitWork, workedSeconds } from "./worked-for";

const NO_UNSUBSCRIBE = () => {
  /* useSyncExternalStore requires an unsubscribe even when the store has none. */
};

export function MessageView({
  message,
  isStreaming,
}: {
  message: PieUIMessage;
  isStreaming: boolean;
}) {
  if (message.role === "assistant") {
    return <CollapsibleAssistantMessage message={message} isStreaming={isStreaming} />;
  }
  return <UserMessage message={message} />;
}

function CollapsibleAssistantMessage({
  message,
  isStreaming,
}: {
  message: PieAssistantUIMessage;
  isStreaming: boolean;
}) {
  const summary = useMemo(
    () => splitWork(message.parts, isStreaming),
    [message.parts, isStreaming],
  );
  const seconds = useWorkedSeconds(isStreaming, message.metadata);
  const [openWhileStreaming, setOpenWhileStreaming] = useState(true);
  const [openWhenSettled, setOpenWhenSettled] = useState(false);

  if (!summary) {
    return <AssistantMessage parts={message.parts} isStreaming={isStreaming} />;
  }

  return (
    <div>
      <Collapsible
        className="not-prose w-full py-1.5"
        open={isStreaming ? openWhileStreaming : openWhenSettled}
        onOpenChange={isStreaming ? setOpenWhileStreaming : setOpenWhenSettled}
      >
        <SummaryTrigger label={formatWorkedFor(seconds)} />
        {/* Flush left, unlike a tool card's body: what folds here is whole
            messages, so indenting them behind a rule would nest the whole
            transcript one level in. */}
        <CollapsibleContent className="mt-2 transition-opacity data-ending-style:opacity-0 data-starting-style:opacity-0">
          <AssistantMessage
            parts={summary.workParts}
            isStreaming={isStreaming && summary.answerParts.length === 0}
            showActions={false}
          />
        </CollapsibleContent>
      </Collapsible>
      {summary.answerParts.length > 0 && (
        <AssistantMessage parts={summary.answerParts} isStreaming={isStreaming} />
      )}
    </div>
  );
}

// Open: now minus messageStartTimestamp, so a remount keeps counting.
// Settled: messageEndTimestamp minus messageStartTimestamp. No start: count from mount.
function useWorkedSeconds(active: boolean, metadata: PieAssistantMetadata | undefined): number {
  const settled = active ? undefined : workedSeconds(metadata);
  const elapsed = useElapsedSeconds(active, metadata?.messageStartTimestamp);
  return settled ?? elapsed;
}

function useElapsedSeconds(active: boolean, start?: string): number {
  const secondsRef = useRef(0);
  const startMs = start === undefined ? Number.NaN : Date.parse(start);
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!active) return NO_UNSUBSCRIBE;
      const startedAt = Number.isFinite(startMs) ? startMs : Date.now() - secondsRef.current * 1000;
      const tick = () => {
        const next = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
        if (next === secondsRef.current) return;
        secondsRef.current = next;
        onChange();
      };
      tick();
      const id = setInterval(tick, 1000);
      return () => {
        tick();
        clearInterval(id);
      };
    },
    [active, startMs],
  );
  const getSnapshot = useCallback(() => secondsRef.current, []);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

// +/- on hover or keyboard focus; Timer stays visible while open. Local rather than
// borrowed: this row is elapsed time, not a tool batch (ListCollapse).
function SummaryTrigger({ label }: { label: string }) {
  return (
    <CollapsibleTrigger
      className="group"
      render={
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground flex w-full cursor-pointer items-center gap-2 overflow-hidden text-left"
          onMouseDown={(event) => event.preventDefault()}
        >
          <span className="relative flex size-4 shrink-0 items-center justify-center">
            <TimerIcon className="size-4 group-focus-within:opacity-0 group-hover:opacity-0" />
            <div className="absolute inset-0 flex items-center justify-center opacity-0 group-focus-within:opacity-100 group-hover:opacity-100">
              <SquarePlusIcon className="size-4 group-data-[panel-open]:hidden" />
              <SquareMinusIcon className="hidden size-4 group-data-[panel-open]:block" />
            </div>
          </span>
          <span className="min-w-0 truncate text-sm leading-none">{label}</span>
        </button>
      }
    />
  );
}
