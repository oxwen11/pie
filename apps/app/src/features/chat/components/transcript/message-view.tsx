import type { PieUIMessage } from "@getpie/contract";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@getpie/ui/components/collapsible";
import { ListTreeIcon, SquareMinusIcon, SquarePlusIcon } from "lucide-react";
import { useCallback, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { AssistantMessage } from "./assistant-message";
import { formatWorkedFor, splitWork, timestampOf, workedSeconds } from "./message-view.logic";
import { UserMessage } from "./user-message";

const NO_UNSUBSCRIBE = () => {
  /* useSyncExternalStore requires an unsubscribe even when the store has none. */
};

export function MessageView({
  message,
  isStreaming,
  previousTimestamp,
}: {
  message: PieUIMessage;
  isStreaming: boolean;
  previousTimestamp?: string;
}) {
  if (message.role === "assistant") {
    return (
      <CollapsibleAssistantMessage
        message={message}
        isStreaming={isStreaming}
        previousTimestamp={previousTimestamp}
      />
    );
  }
  return <UserMessage message={message} />;
}

function CollapsibleAssistantMessage({
  message,
  isStreaming,
  previousTimestamp,
}: {
  message: PieUIMessage;
  isStreaming: boolean;
  previousTimestamp?: string;
}) {
  const summary = useMemo(
    () => splitWork(message.parts, isStreaming),
    [message.parts, isStreaming],
  );
  const historySeconds = workedSeconds(previousTimestamp, timestampOf(message.metadata));
  const elapsed = useElapsedSeconds(isStreaming);
  const [openWhileStreaming, setOpenWhileStreaming] = useState(true);
  const [openWhenSettled, setOpenWhenSettled] = useState(false);

  if (!summary) {
    return <AssistantMessage parts={message.parts} isStreaming={isStreaming} />;
  }

  return (
    <div>
      <Collapsible
        className="not-prose w-full py-1"
        open={isStreaming ? openWhileStreaming : openWhenSettled}
        onOpenChange={isStreaming ? setOpenWhileStreaming : setOpenWhenSettled}
      >
        <SummaryTrigger label={formatWorkedFor(historySeconds ?? elapsed)} />
        {/* Flush left, unlike a tool card's body: what folds here is whole
            messages, so indenting them behind a rule would nest the whole
            transcript one level in. */}
        <CollapsibleContent className="mt-2 space-y-2 transition-opacity data-ending-style:opacity-0 data-starting-style:opacity-0">
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

function useElapsedSeconds(active: boolean): number {
  const secondsRef = useRef(0);
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!active) return NO_UNSUBSCRIBE;
      const startedAt = Date.now() - secondsRef.current * 1000;
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
    [active],
  );
  const getSnapshot = useCallback(() => secondsRef.current, []);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

// +/- only on hover; ListTree stays visible while open. Local rather than
// borrowed: this row summarises a turn, not a tool call.
function SummaryTrigger({ label }: { label: string }) {
  return (
    <CollapsibleTrigger
      className="group"
      render={
        <div className="text-muted-foreground hover:text-foreground flex w-full cursor-pointer items-center gap-2 overflow-hidden">
          <span className="relative flex size-4 shrink-0 items-center justify-center">
            <ListTreeIcon className="size-4 group-hover:opacity-0" />
            <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100">
              <SquarePlusIcon className="size-4 group-data-[panel-open]:hidden" />
              <SquareMinusIcon className="hidden size-4 group-data-[panel-open]:block" />
            </div>
          </span>
          <span className="min-w-0 truncate text-sm leading-none">{label}</span>
        </div>
      }
    />
  );
}
