import { cn } from "@getpie/ui/lib/utils";
import type { HTMLAttributes } from "react";

export type LoadingBoxProps = HTMLAttributes<HTMLDivElement>;

/** Bordered status card for an in-flight agent wait — not a spinner. */
export function LoadingBox({ className, ...props }: LoadingBoxProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      data-slot="loading-box"
      className={cn(
        "border-border bg-card text-muted-foreground my-2 w-full max-w-2xl rounded-lg border px-3 py-2.5 text-sm",
        className,
      )}
      {...props}
    />
  );
}
