"use client";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@getpie/ui/components/collapsible";
import { useControllableState } from "@getpie/ui/hooks/use-controllable-state";
import { cn } from "@getpie/ui/lib/utils";
import { SquareMinusIcon, SquarePlusIcon } from "lucide-react";
import type { ComponentProps } from "react";
import { createContext, memo, useContext, useEffect, useMemo, useState } from "react";

import { PieLoader } from "./pie-loader";
import { Response } from "./response";
import { Shimmer } from "./shimmer";

type ReasoningContextValue = {
  isStreaming: boolean;
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  duration: number | undefined;
};

const ReasoningContext = createContext<ReasoningContextValue | null>(null);

const useReasoning = () => {
  const context = useContext(ReasoningContext);
  if (!context) {
    throw new Error("Reasoning components must be used within Reasoning");
  }
  return context;
};

export type ReasoningProps = ComponentProps<typeof Collapsible> & {
  isStreaming?: boolean;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Elapsed thinking time in seconds, only when the caller has a real source. */
  duration?: number;
};

const AUTO_CLOSE_DELAY = 1000;

export const Reasoning = memo(
  ({
    className,
    isStreaming = false,
    open,
    defaultOpen = true,
    onOpenChange,
    duration,
    children,
    ...props
  }: ReasoningProps) => {
    const [isOpen, setIsOpen] = useControllableState({
      prop: open,
      defaultProp: defaultOpen,
      onChange: onOpenChange,
    });

    const [hasAutoClosedRef, setHasAutoClosedRef] = useState(false);

    // Auto-open when streaming starts, auto-close when streaming ends (once only)
    useEffect(() => {
      if (!(defaultOpen && !isStreaming && isOpen && !hasAutoClosedRef)) {
        return;
      }

      // Add a small delay before closing to allow user to see the content
      const timer = setTimeout(() => {
        setIsOpen(false);
        setHasAutoClosedRef(true);
      }, AUTO_CLOSE_DELAY);

      return () => clearTimeout(timer);
    }, [isStreaming, isOpen, defaultOpen, setIsOpen, hasAutoClosedRef]);

    const contextValue = useMemo<ReasoningContextValue>(
      () => ({ isStreaming, isOpen: isOpen ?? false, setIsOpen, duration }),
      [isStreaming, isOpen, setIsOpen, duration],
    );

    return (
      <ReasoningContext.Provider value={contextValue}>
        <Collapsible
          className={cn("not-prose mb-4", className)}
          onOpenChange={setIsOpen}
          open={isOpen}
          {...props}
        >
          {children}
        </Collapsible>
      </ReasoningContext.Provider>
    );
  },
);

export type ReasoningTriggerProps = ComponentProps<typeof CollapsibleTrigger>;

export const ReasoningTrigger = memo(({ className, children, ...props }: ReasoningTriggerProps) => {
  const { isStreaming, duration } = useReasoning();
  let label = "Thought";
  if (duration !== undefined && duration >= 1) {
    label = `Thought for ${duration} ${duration === 1 ? "second" : "seconds"}`;
  }

  return (
    <CollapsibleTrigger
      className={cn("group text-muted-foreground flex items-center gap-2 text-sm", className)}
      {...props}
    >
      {children ?? (
        <>
          <span className="relative size-4 shrink-0">
            <PieLoader
              aria-hidden
              animated={isStreaming}
              className="size-4 group-hover:opacity-0 group-data-[panel-open]:opacity-0"
            />
            <span className="absolute inset-0 opacity-0 group-hover:opacity-100 group-data-[panel-open]:opacity-100">
              <SquarePlusIcon className="size-4 group-data-[panel-open]:hidden" />
              <SquareMinusIcon className="hidden size-4 group-data-[panel-open]:block" />
            </span>
          </span>
          {isStreaming ? (
            <Shimmer duration={2} as="span">
              Thinking…
            </Shimmer>
          ) : (
            <p>{label}</p>
          )}
        </>
      )}
    </CollapsibleTrigger>
  );
});

export type ReasoningContentProps = ComponentProps<typeof CollapsibleContent> & {
  children: string;
};

export const ReasoningContent = memo(({ className, children, ...props }: ReasoningContentProps) => {
  const { isStreaming } = useReasoning();
  return (
    <CollapsibleContent
      className={cn(
        "mt-4 text-sm",
        "text-popover-foreground transition-opacity outline-none data-ending-style:opacity-0 data-starting-style:opacity-0",
        className,
      )}
      {...props}
    >
      <Response isAnimating={isStreaming}>{children}</Response>
    </CollapsibleContent>
  );
});

Reasoning.displayName = "Reasoning";
ReasoningTrigger.displayName = "ReasoningTrigger";
ReasoningContent.displayName = "ReasoningContent";
