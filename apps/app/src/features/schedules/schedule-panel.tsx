import { Button, type ButtonProps } from "@getpie/ui/components/button";
import { cn } from "@getpie/ui/lib/utils";
import { XIcon } from "lucide-react";
import type React from "react";

export type SchedulePanelProps = React.ComponentProps<"aside">;

export function SchedulePanel({ className, ...props }: SchedulePanelProps) {
  return (
    <aside
      className={cn("flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden border-s", className)}
      data-slot="schedule-panel"
      {...props}
    />
  );
}

export type SchedulePanelHeaderProps = React.ComponentProps<"header">;

export function SchedulePanelHeader({ className, ...props }: SchedulePanelHeaderProps) {
  return (
    <header
      className={cn("flex h-10 shrink-0 items-center gap-2 border-b px-3", className)}
      data-slot="schedule-panel-header"
      {...props}
    />
  );
}

export type SchedulePanelTitleProps = React.ComponentProps<"h2">;

export function SchedulePanelTitle({ className, children, ...props }: SchedulePanelTitleProps) {
  return (
    <h2
      className={cn("min-w-0 flex-1 truncate text-sm font-medium", className)}
      data-slot="schedule-panel-title"
      {...props}
    >
      {children}
    </h2>
  );
}

export type SchedulePanelCloseProps = ButtonProps;

export function SchedulePanelClose({ children, ...props }: SchedulePanelCloseProps) {
  return (
    <Button
      aria-label="Close"
      data-slot="schedule-panel-close"
      size="icon-xs"
      variant="ghost"
      {...props}
    >
      {children ?? <XIcon aria-hidden="true" className="size-3.5" />}
    </Button>
  );
}

export type SchedulePanelBodyProps = React.ComponentProps<"div">;

export function SchedulePanelBody({ className, ...props }: SchedulePanelBodyProps) {
  return (
    <div
      className={cn("flex min-h-0 flex-1 flex-col overflow-y-auto p-4", className)}
      data-slot="schedule-panel-body"
      {...props}
    />
  );
}
