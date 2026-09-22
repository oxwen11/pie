import type { ComponentProps, ReactElement } from "react";
import { Separator } from "react-resizable-panels";

type PanelSeparatorProps = Omit<ComponentProps<typeof Separator>, "aria-label" | "className"> & {
  /** Accessible name for the resize handle. */
  label: string;
};

/** Shared chrome for a horizontal panel resize handle. */
export function PanelSeparator({ label, ...props }: PanelSeparatorProps): ReactElement {
  return (
    <Separator
      className="after:bg-border hover:after:bg-foreground/30 data-[separator=active]:after:bg-primary relative w-1.5 bg-transparent after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 data-[separator=active]:after:w-0.5"
      {...props}
      aria-label={label}
    />
  );
}
