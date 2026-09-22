import { cn } from "@getpie/ui/lib/utils";
import { type PointerEvent as ReactPointerEvent, type ReactNode, useRef } from "react";

export function ShellGutter({
  className,
  disabled = false,
  label,
  onPointerDown,
  onPointerMove,
  onPointerUp,
}: {
  className?: string;
  disabled?: boolean;
  label: string;
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void;
}): ReactNode {
  const grip = useRef<HTMLSpanElement>(null);

  const placeGrip = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const mark = grip.current;
    if (mark === null || disabled) return;
    const rect = event.currentTarget.getBoundingClientRect();
    mark.style.left = `${event.clientX - rect.left}px`;
    mark.style.top = `${event.clientY - rect.top}px`;
    mark.style.opacity = "1";
  };
  const hideGrip = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) return;
    if (grip.current !== null) grip.current.style.opacity = "0";
  };

  return (
    <div
      aria-disabled={disabled || undefined}
      aria-label={label}
      aria-orientation="vertical"
      className={cn(
        "text-foreground relative z-30 w-1 cursor-col-resize touch-none bg-transparent [-webkit-app-region:no-drag] md:my-1",
        disabled && "w-0",
        className,
      )}
      data-slot="shell-gutter"
      onLostPointerCapture={onPointerUp}
      onPointerDown={onPointerDown}
      onPointerEnter={placeGrip}
      onPointerLeave={hideGrip}
      onPointerMove={(event) => {
        placeGrip(event);
        onPointerMove(event);
      }}
      onPointerUp={onPointerUp}
      role="separator"
    >
      <div className={cn("absolute -inset-x-8 inset-y-0", disabled && "hidden")} />
      <span
        className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 opacity-0"
        ref={grip}
      >
        <svg aria-hidden className="size-7 drop-shadow" fill="none" viewBox="0 0 28 28">
          <g stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.75">
            <path d="M14 4v20" />
            <path d="M14 14H4.5M4.5 14l4.5-4.5M4.5 14l4.5 4.5" />
            <path d="M14 14h9.5M23.5 14l-4.5-4.5M23.5 14l-4.5 4.5" />
          </g>
        </svg>
      </span>
    </div>
  );
}
