import { cn } from "@getpie/ui/lib/utils";
import type { CSSProperties, HTMLAttributes } from "react";

const SOUTH_EAST_DOTS = new Set([10, 11, 14, 15]);

const DOT_ANIMATIONS = [
  "animate-pie-dot-grid-1",
  "animate-pie-dot-grid-2",
  "animate-pie-dot-grid-3",
  "animate-pie-dot-grid-4",
  "animate-pie-dot-grid-5",
  "animate-pie-dot-grid-6",
  "animate-pie-dot-grid-7",
  "animate-pie-dot-grid-8",
  "animate-pie-dot-grid-9",
  "animate-pie-dot-grid-10",
  "animate-pie-dot-grid-11",
  "animate-pie-dot-grid-12",
  "animate-pie-dot-grid-13",
  "animate-pie-dot-grid-14",
  "animate-pie-dot-grid-15",
  "animate-pie-dot-grid-16",
] as const;

type PieLoaderStyle = CSSProperties & {
  "--dot-grid-size"?: string;
};

export type PieLoaderProps = HTMLAttributes<HTMLSpanElement> & {
  /** Outer mark size in px. Omit to follow the surrounding `1em` text size. */
  size?: number;
};

/** 4×4 pie-mark loader. Layout is Tailwind; motion keyframes live in `pie-loader.css`. */
export function PieLoader({ className, size, style, ...props }: PieLoaderProps) {
  const hidden = props["aria-hidden"] === true || props["aria-hidden"] === "true";
  const markStyle: PieLoaderStyle | undefined =
    size == null
      ? style
      : {
          "--dot-grid-size": `${size}px`,
          ...style,
        };

  return (
    <span
      role={hidden ? undefined : "status"}
      aria-label={hidden ? undefined : "Thinking"}
      aria-live={hidden ? undefined : "polite"}
      data-slot="pie-loader"
      className={cn(
        "[container-type:size] inline-grid size-[var(--dot-grid-size)] shrink-0 grid-cols-4 grid-rows-4 overflow-visible align-middle text-current [--dot-grid-animation-delay:-538ms] [--dot-grid-animation-duration:2s] [--dot-grid-off-opacity:0] [--dot-grid-size:1em]",
        className,
      )}
      style={markStyle}
      {...props}
    >
      {DOT_ANIMATIONS.map((animation, i) => (
        <span
          key={animation}
          data-slot="pie-dot"
          className={cn(
            "size-[70%] min-h-0 min-w-0 place-self-center rounded-full bg-current motion-reduce:animate-none motion-reduce:opacity-100",
            animation,
            SOUTH_EAST_DOTS.has(i) && "translate-x-[10cqw] translate-y-[10cqh]",
          )}
        />
      ))}
    </span>
  );
}
