import { cn } from "@getpie/ui/lib/utils";
import type { HTMLAttributes } from "react";

export type PieLoaderProps = HTMLAttributes<HTMLSpanElement> & {
  /** Outer mark size. Layout, kick, and motion are CSS. */
  size?: number;
};

/** 4×4 pie-mark loader. The host only mounts sixteen dots; CSS does the rest. */
export function PieLoader({ className, size = 16, style, ...props }: PieLoaderProps) {
  const hidden = props["aria-hidden"] === true || props["aria-hidden"] === "true";
  return (
    <span
      role={hidden ? undefined : "status"}
      aria-label={hidden ? undefined : "Thinking"}
      aria-live={hidden ? undefined : "polite"}
      data-slot="pie-loader"
      className={cn("size-4 shrink-0 text-current", className)}
      style={{ width: size, height: size, ...style }}
      {...props}
    >
      <span data-slot="pie-dot" />
      <span data-slot="pie-dot" />
      <span data-slot="pie-dot" />
      <span data-slot="pie-dot" />
      <span data-slot="pie-dot" />
      <span data-slot="pie-dot" />
      <span data-slot="pie-dot" />
      <span data-slot="pie-dot" />
      <span data-slot="pie-dot" />
      <span data-slot="pie-dot" />
      <span data-slot="pie-dot" />
      <span data-slot="pie-dot" />
      <span data-slot="pie-dot" />
      <span data-slot="pie-dot" />
      <span data-slot="pie-dot" />
      <span data-slot="pie-dot" />
    </span>
  );
}
