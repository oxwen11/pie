import { cn } from "@getpie/ui/lib/utils";
import type { HTMLAttributes } from "react";

const GRID = 4;
const VIEWBOX = 16;
const STEP = 3.5;
const ORIGIN = 1.75;
const RADIUS = 1.35;
const KICK = VIEWBOX * 0.03;

const CELLS = Array.from({ length: GRID * GRID }, (_, index) => {
  const col = index % GRID;
  const row = Math.floor(index / GRID);
  return {
    index: index + 1,
    cx: ORIGIN + col * STEP,
    cy: ORIGIN + row * STEP,
    kick: col >= 2 && row >= 2,
    animation: `animate-pie-dot-grid-${index + 1}`,
  };
});

export type PieLoaderProps = HTMLAttributes<HTMLSpanElement> & {
  /** Outer mark size. The 4×4 grid scales to fill it. */
  size?: number;
};

/** Sixteen even dots, SE four kicked. A connected on/off band travels left to right. */
export function PieLoader({ className, size = 16, style, ...props }: PieLoaderProps) {
  const hidden = props["aria-hidden"] === true || props["aria-hidden"] === "true";
  return (
    <span
      role={hidden ? undefined : "status"}
      aria-label={hidden ? undefined : "Thinking"}
      aria-live={hidden ? undefined : "polite"}
      data-slot="pie-loader"
      className={cn("inline-flex shrink-0 text-current", className)}
      style={{ width: size, height: size, ...style }}
      {...props}
    >
      <svg
        viewBox={`0 0 ${VIEWBOX} ${VIEWBOX}`}
        width={size}
        height={size}
        aria-hidden
        focusable="false"
        className="overflow-visible"
      >
        {CELLS.map(({ index, cx, cy, kick, animation }) => (
          <circle
            key={index}
            data-slot="pie-dot"
            data-dot-index={index}
            data-kick={kick ? "se" : undefined}
            cx={cx}
            cy={cy}
            r={RADIUS}
            fill="currentColor"
            className={cn(animation, "motion-reduce:animate-none motion-reduce:opacity-100")}
            transform={kick ? `translate(${KICK} ${KICK})` : undefined}
          />
        ))}
      </svg>
    </span>
  );
}
