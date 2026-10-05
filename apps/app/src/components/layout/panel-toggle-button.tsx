import { Button } from "@getpie/ui/components/button";
import { cn } from "@getpie/ui/lib/utils";
import type { LucideIcon } from "lucide-react";
import type { ReactElement } from "react";

/** Shared chrome for the sidebar and content-panel toggles. */
export function PanelToggleButton({
  className,
  closeIcon: CloseIcon,
  label,
  onClick,
  open,
  openIcon: OpenIcon,
}: {
  readonly className?: string;
  readonly closeIcon: LucideIcon;
  readonly label: string;
  readonly onClick: () => void;
  readonly open: boolean;
  readonly openIcon: LucideIcon;
}): ReactElement {
  const Icon = open ? CloseIcon : OpenIcon;
  return (
    <Button
      aria-label={label}
      aria-pressed={open}
      className={cn("size-9", className)}
      data-pressed={open ? "" : undefined}
      onClick={onClick}
      size="icon"
      variant="ghost"
    >
      <Icon />
    </Button>
  );
}
