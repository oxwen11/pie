import { cn } from "@getpie/ui/lib/utils";
import type React from "react";

export type ScheduleDetailDescriptionProps = React.ComponentProps<"div">;

export function ScheduleDetailDescription({
  className,
  children,
  ...props
}: ScheduleDetailDescriptionProps) {
  return (
    <div
      className={cn("flex flex-col gap-1", className)}
      data-slot="schedule-detail-description"
      {...props}
    >
      {children}
    </div>
  );
}

export type ScheduleDetailLineProps = React.ComponentProps<"p">;

export function ScheduleDetailLine({ className, children, ...props }: ScheduleDetailLineProps) {
  return (
    <p
      className={cn("text-muted-foreground text-sm", className)}
      data-slot="schedule-detail-line"
      {...props}
    >
      {children}
    </p>
  );
}

export type ScheduleDetailActionsProps = React.ComponentProps<"div">;

export function ScheduleDetailActions({ className, ...props }: ScheduleDetailActionsProps) {
  return (
    <div
      className={cn("flex flex-wrap gap-1", className)}
      data-slot="schedule-detail-actions"
      {...props}
    />
  );
}

export type ScheduleDetailHistoryProps = React.ComponentProps<"section">;

export function ScheduleDetailHistory({
  className,
  children,
  ...props
}: ScheduleDetailHistoryProps) {
  return (
    <section
      className={cn("flex min-h-0 flex-col gap-2", className)}
      data-slot="schedule-detail-history"
      {...props}
    >
      {children}
    </section>
  );
}
