import type { PieAssistantMetadata, PieAssistantUIMessage, PieUIMessage } from "@getpie/contract";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@getpie/ui/components/collapsible";
import { isToolUIPart } from "ai";
import { ListTreeIcon, SquareMinusIcon, SquarePlusIcon } from "lucide-react";
import { useCallback, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { AssistantMessage } from "./assistant-message";
import { UserMessage } from "./user-message";

type Part = PieUIMessage["parts"][number];

export function isVisibleWorkPart(part: Part): boolean {
  if (isToolUIPart(part)) return true;
  if (part.type === "reasoning") return true;
  return part.type === "text" && part.text.trim() !== "";
}

export function splitWork(
  parts: readonly Part[],
  isStreaming: boolean,
): { workParts: Part[]; answerParts: Part[] } | null {
  if (isStreaming) {
    return parts.length === 0 ? null : { workParts: [...parts], answerParts: [] };
  }

  let lastText = -1;
  for (const [index, part] of parts.entries()) {
    if (part.type === "text" && part.text.trim() !== "") lastText = index;
  }
  const workAfterLastText =
    lastText >= 0 && parts.slice(lastText + 1).some((part) => isVisibleWorkPart(part));
  if (lastText >= 0 && !workAfterLastText) {
    const workParts = parts.slice(0, lastText);
    if (!workParts.some((part) => isVisibleWorkPart(part))) return null;
    return { workParts, answerParts: parts.slice(lastText) };
  }
  if (!parts.some((part) => isVisibleWorkPart(part))) return null;
  return { workParts: [...parts], answerParts: [] };
}

export function formatWorkedFor(seconds: number): string {
  if (seconds < 60) return `Worked for ${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest === 0 ? `Worked for ${minutes}m` : `Worked for ${minutes}m ${rest}s`;
}

/** Settled span: messageEndTimestamp minus messageStartTimestamp, in whole seconds. */
export function workedSeconds(
  metadata: Pick<PieAssistantMetadata, "messageStartTimestamp" | "messageEndTimestamp"> | undefined,
): number | undefined {
  const from = metadata?.messageStartTimestamp;
  const to = metadata?.messageEndTimestamp;
  if (from === undefined || to === undefined) return undefined;
  const start = Date.parse(from);
  const end = Date.parse(to);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return undefined;
  return Math.floor((end - start) / 1000);
}

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
        className="not-prose w-full py-1"
        open={isStreaming ? openWhileStreaming : openWhenSettled}
        onOpenChange={isStreaming ? setOpenWhileStreaming : setOpenWhenSettled}
      >
        <SummaryTrigger label={formatWorkedFor(seconds)} />
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

// The turn's icon swaps to a +/- box on hover or once open, the same
// affordance ToolHeader gives a tool card. Local rather than borrowed: this
// row summarises a turn, not a tool call, so it doesn't belong to that family.
function SummaryTrigger({ label }: { label: string }) {
  return (
    <CollapsibleTrigger
      className="group"
      render={
        <div className="text-muted-foreground hover:text-foreground flex w-full cursor-pointer items-center gap-2 overflow-hidden">
          <span className="relative">
            <ListTreeIcon className="size-4 group-focus-within:opacity-0 group-hover:opacity-0 group-data-[panel-open]:opacity-0" />
            <div className="absolute inset-0 size-4 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 group-data-[panel-open]:opacity-100">
              <SquarePlusIcon className="size-4 group-data-[panel-open]:hidden" />
              <SquareMinusIcon className="hidden size-4 group-data-[panel-open]:block" />
            </div>
          </span>
          <span className="truncate text-sm">{label}</span>
        </div>
      }
    />
  );
}
