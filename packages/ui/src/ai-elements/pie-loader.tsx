import { cn } from "@getpie/ui/lib/utils";
import type { CSSProperties, HTMLAttributes } from "react";

import "./pie-loader.css";

export type PieLoaderProps = HTMLAttributes<HTMLSpanElement> & {
  /** Outer mark size in px. Omit to follow the surrounding `1em` text size. */
  size?: number;
};

/** 4×4 pie-mark loader. The host only mounts sixteen dots; CSS does the rest. */
export function PieLoader({ className, size, style, ...props }: PieLoaderProps) {
  const hidden = props["aria-hidden"] === true || props["aria-hidden"] === "true";
  return (
    <span
      role={hidden ? undefined : "status"}
      aria-label={hidden ? undefined : "Thinking"}
      aria-live={hidden ? undefined : "polite"}
      data-slot="pie-loader"
      className={cn("shrink-0 text-current", className)}
      style={
        size == null
          ? style
          : ({
              "--dot-grid-size": `${size}px`,
              width: size,
              height: size,
              ...style,
            } as CSSProperties)
      }
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
