"use client";

import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cn } from "@getpie/ui/lib/utils";
import { cva, type VariantProps } from "class-variance-authority";
import type React from "react";

export const markerVariants = cva(
  "group/marker text-muted-foreground [&_a:hover]:text-foreground relative flex min-h-4 w-full items-center gap-2 text-left text-sm [&_a]:underline [&_a]:underline-offset-3 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "",
        separator:
          "before:bg-border after:bg-border before:mr-1 before:h-px before:min-w-0 before:flex-1 after:ml-1 after:h-px after:min-w-0 after:flex-1",
      },
    },
  },
);

export type MarkerProps = useRender.ComponentProps<"div"> & VariantProps<typeof markerVariants>;

export function Marker({ className, variant = "default", render, ...props }: MarkerProps) {
  return useRender({
    defaultTagName: "div",
    props: mergeProps<"div">({ className: cn(markerVariants({ variant, className })) }, props),
    render,
    state: { slot: "marker", variant },
  });
}

export type MarkerIconProps = React.ComponentProps<"span">;

export function MarkerIcon({ className, ...props }: MarkerIconProps) {
  return (
    <span
      data-slot="marker-icon"
      aria-hidden="true"
      className={cn("size-4 shrink-0 [&_svg:not([class*='size-'])]:size-4", className)}
      {...props}
    />
  );
}

export type MarkerContentProps = React.ComponentProps<"span">;

export function MarkerContent({ className, ...props }: MarkerContentProps) {
  return (
    <span
      data-slot="marker-content"
      className={cn(
        "min-w-0 wrap-break-word group-data-[variant=separator]/marker:flex-none group-data-[variant=separator]/marker:text-center",
        className,
      )}
      {...props}
    />
  );
}
