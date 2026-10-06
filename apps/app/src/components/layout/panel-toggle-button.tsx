import { Button } from "@getpie/ui/components/button";
import type { LucideIcon } from "lucide-react";
import type { ComponentProps, ReactElement } from "react";

/** Shared chrome for the sidebar and content-panel toggles. The icon alone carries the state. */
export function PanelToggleButton({
  className,
  closeIcon: CloseIcon,
  label,
  onClick,
  open,
  openIcon: OpenIcon,
  ...props
}: ComponentProps<typeof Button> & {
  readonly closeIcon: LucideIcon;
  readonly label: string;
  readonly open: boolean;
  readonly openIcon: LucideIcon;
}): ReactElement {
  const Icon = open ? CloseIcon : OpenIcon;
  return (
    <Button
      {...props}
      aria-label={label}
      aria-pressed={open}
      className={className}
      onClick={onClick}
      size="icon-sm"
      variant="ghost"
    >
      <Icon />
    </Button>
  );
}
