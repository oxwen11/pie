import { cn } from "@getpie/ui/lib/utils";
import type { CSSProperties, HTMLAttributes } from "react";

const CORNERS = [
  { corner: "nw", animation: "animate-pie-dot-nw" },
  { corner: "ne", animation: "animate-pie-dot-ne" },
  { corner: "sw", animation: "animate-pie-dot-sw" },
  { corner: "se", animation: "animate-pie-dot-se" },
] as const;

export type PieLoaderProps = HTMLAttributes<HTMLSpanElement> & {
  /** Outer mark size, including room for the kicked-out dot. */
  size?: number;
};

/** Four dots in the pie-mark layout: one corner stays offset, cycling SE → NE → NW → SW. */
export function PieLoader({ className, size = 20, style, ...props }: PieLoaderProps) {
  const kick = size * 0.16;
  const hidden = props["aria-hidden"] === true || props["aria-hidden"] === "true";
  return (
    <span
      role={hidden ? undefined : "status"}
      aria-label={hidden ? undefined : "Thinking"}
      aria-live={hidden ? undefined : "polite"}
      data-slot="pie-loader"
      className={cn("inline-grid shrink-0 grid-cols-2 grid-rows-2", className)}
      style={
        {
          width: size,
          height: size,
          gap: size * 0.1,
          padding: kick,
          "--pie-kick": `${kick}px`,
          ...style,
        } as CSSProperties
      }
      {...props}
    >
      {CORNERS.map(({ corner, animation }) => (
        <span
          key={corner}
          aria-hidden
          data-slot="pie-dot"
          data-corner={corner}
          className={cn(
            "size-full rounded-full bg-current motion-reduce:animate-none",
            animation,
            corner === "se" && "motion-reduce:[translate:var(--pie-kick)_var(--pie-kick)]",
          )}
        />
      ))}
    </span>
  );
}
