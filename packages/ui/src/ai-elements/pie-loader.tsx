import { cn } from "@getpie/ui/lib/utils";
import type { CSSProperties, HTMLAttributes } from "react";

const CLUSTERS = [
  {
    corner: "nw",
    cells: [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ],
  },
  {
    corner: "ne",
    cells: [
      [2, 0],
      [3, 0],
      [2, 1],
      [3, 1],
    ],
  },
  {
    corner: "sw",
    cells: [
      [0, 2],
      [1, 2],
      [0, 3],
      [1, 3],
    ],
  },
  {
    corner: "se",
    cells: [
      [2, 2],
      [3, 2],
      [2, 3],
      [3, 3],
    ],
  },
] as const;

/** Inner inset that keeps the 16-dot mark at the size that reads. */
const PAD_RATIO = 0.28;
/** SE cluster offset — a light logo kick. */
const KICK_RATIO = 0.03;
const CHASE_DURATION_S = 1.6;

export type PieLoaderProps = HTMLAttributes<HTMLSpanElement> & {
  /** Outer mark size, including room for the kicked-out square. */
  size?: number;
};

/** Sixteen dots in the pie-mark layout. Shape is fixed; a highlight chases the grid. */
export function PieLoader({ className, size = 24, style, ...props }: PieLoaderProps) {
  const pad = size * PAD_RATIO;
  const kick = size * KICK_RATIO;
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
          padding: pad,
          "--pie-kick": `${kick}px`,
          ...style,
        } as CSSProperties
      }
      {...props}
    >
      {CLUSTERS.map(({ corner, cells }) => (
        <span
          key={corner}
          aria-hidden
          data-slot="pie-cluster"
          data-corner={corner}
          className={cn(
            "grid size-full grid-cols-2 grid-rows-2",
            corner === "se" && "[translate:var(--pie-kick)_var(--pie-kick)]",
          )}
          style={{ gap: Math.max(1, size * 0.04) }}
        >
          {cells.map(([x, y]) => (
            <span
              key={`${x}-${y}`}
              data-slot="pie-dot"
              className="animate-pie-dot-chase size-full rounded-full bg-current motion-reduce:animate-none motion-reduce:opacity-100"
              style={{ animationDelay: `${(y * 4 + x) * (CHASE_DURATION_S / 16)}s` }}
            />
          ))}
        </span>
      ))}
    </span>
  );
}
