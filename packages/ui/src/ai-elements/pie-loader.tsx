import { cn } from "@getpie/ui/lib/utils";
import type { HTMLAttributes } from "react";

const CELLS = [
  { index: 1, cx: 1.25, cy: 1.25, animation: "animate-pie-dot-grid-1" },
  { index: 2, cx: 5.25, cy: 1.25, animation: "animate-pie-dot-grid-2" },
  { index: 3, cx: 9.25, cy: 1.25, animation: "animate-pie-dot-grid-3" },
  { index: 4, cx: 1.25, cy: 5.25, animation: "animate-pie-dot-grid-4" },
  { index: 5, cx: 5.25, cy: 5.25, animation: "animate-pie-dot-grid-5" },
  { index: 6, cx: 9.25, cy: 5.25, animation: "animate-pie-dot-grid-6" },
  { index: 7, cx: 1.25, cy: 9.25, animation: "animate-pie-dot-grid-7" },
  { index: 8, cx: 5.25, cy: 9.25, animation: "animate-pie-dot-grid-8" },
  { index: 9, cx: 9.25, cy: 9.25, animation: "animate-pie-dot-grid-9" },
] as const;

export type PieLoaderProps = HTMLAttributes<HTMLSpanElement> & {
  /** Outer mark size. The 3×3 grid scales to fill it. */
  size?: number;
};

/** 3×3 dot-grid morph: cells fade fully on/off through a looping frame sequence. */
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
        viewBox="0 0 10.5 10.5"
        width={size}
        height={size}
        aria-hidden
        focusable="false"
        className="overflow-visible"
      >
        {CELLS.map(({ index, cx, cy, animation }) => (
          <circle
            key={index}
            data-slot="pie-dot"
            data-dot-index={index}
            cx={cx}
            cy={cy}
            r={1.125}
            fill="currentColor"
            className={cn(animation, "motion-reduce:animate-none")}
          />
        ))}
      </svg>
    </span>
  );
}
