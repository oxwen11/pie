import { cn } from "@getpie/ui/lib/utils";
import type { CSSProperties, HTMLAttributes } from "react";

const CORNERS = [
  { corner: "nw", animation: "animate-pie-dot-nw" },
  { corner: "ne", animation: "animate-pie-dot-ne" },
  { corner: "sw", animation: "animate-pie-dot-sw" },
  { corner: "se", animation: "animate-pie-dot-se" },
] as const;

const DOTS = [0, 1, 2, 3] as const;

export type PieLoaderProps = HTMLAttributes<HTMLSpanElement> & {
  /** Outer mark size, including room for the kicked-out square. */
  size?: number;
};

/** Four 2×2 dot squares in the pie-mark layout. One square stays offset, cycling SE → NE → NW → SW. */
export function PieLoader({ className, size = 24, style, ...props }: PieLoaderProps) {
  const kick = size * 0.12;
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
          gap: size * 0.08,
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
          data-slot="pie-cluster"
          data-corner={corner}
          className={cn(
            "grid size-full grid-cols-2 grid-rows-2 motion-reduce:animate-none",
            animation,
            corner === "se" && "motion-reduce:[translate:var(--pie-kick)_var(--pie-kick)]",
          )}
          style={{ gap: Math.max(1, size * 0.04) }}
        >
          {DOTS.map((dot) => (
            <span key={dot} data-slot="pie-dot" className="size-full rounded-full bg-current" />
          ))}
        </span>
      ))}
    </span>
  );
}
