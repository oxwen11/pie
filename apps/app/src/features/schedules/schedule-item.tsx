import { cn } from "@getpie/ui/lib/utils";
import type React from "react";

export type ScheduleItemProps = React.ComponentProps<"li">;

export function ScheduleItem({ className, ...props }: ScheduleItemProps) {
  return (
    <li
      className={cn(
        "hover:bg-accent/50 has-data-checked:border-primary/48 has-data-checked:bg-accent/50 flex items-center gap-6 rounded-lg border p-3",
        className,
      )}
      data-slot="schedule-item"
      {...props}
    />
  );
}

export type ScheduleItemTriggerProps = React.ComponentProps<"button">;

export function ScheduleItemTrigger({ className, ...props }: ScheduleItemTriggerProps) {
  return (
    <button
      className={cn(
        "focus-visible:ring-ring flex min-w-0 flex-1 flex-col gap-1 rounded-md text-left focus-visible:ring-2 focus-visible:outline-none",
        className,
      )}
      data-slot="schedule-item-trigger"
      {...props}
      type="button"
    />
  );
}

export type ScheduleItemTitleProps = React.ComponentProps<"p">;

export function ScheduleItemTitle({ className, ...props }: ScheduleItemTitleProps) {
  return <p className={cn("truncate", className)} data-slot="schedule-item-title" {...props} />;
}

export type ScheduleItemDescriptionProps = React.ComponentProps<"p">;

export function ScheduleItemDescription({ className, ...props }: ScheduleItemDescriptionProps) {
  return (
    <p
      className={cn("text-muted-foreground truncate text-xs", className)}
      data-slot="schedule-item-description"
      {...props}
    />
  );
}
