import { cn } from "@getpie/ui/lib/utils";
import { type PointerEvent as ReactPointerEvent, type ReactNode, useRef } from "react";

const lineBackground =
  "linear-gradient(to bottom, transparent, currentColor var(--gutter-y, 50%), transparent)";

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
  const line = useRef<HTMLSpanElement>(null);

  const placeLine = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const mark = line.current;
    if (mark === null || disabled) return;
    const rect = event.currentTarget.getBoundingClientRect();
    mark.style.setProperty("--gutter-y", `${event.clientY - rect.top}px`);
    mark.style.opacity = "1";
  };
  const hideLine = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) return;
    if (line.current !== null) line.current.style.opacity = "0";
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
      onPointerEnter={placeLine}
      onPointerLeave={hideLine}
      onPointerMove={(event) => {
        placeLine(event);
        onPointerMove(event);
      }}
      onPointerUp={onPointerUp}
      role="separator"
    >
      <div className={cn("absolute inset-y-0 -right-8 left-0", disabled && "hidden")} />
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-0 right-0 w-px opacity-0"
        ref={line}
        style={{
          background: lineBackground,
          transform: "scaleX(0.5)",
          transformOrigin: "right center",
        }}
      />
    </div>
  );
}
