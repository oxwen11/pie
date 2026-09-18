import type { LucideIcon } from "lucide-react";

// Shared one-line, non-collapsible tool row. Tools whose transcript footprint
// is a single muted line (read today) compose this instead of a full Tool card.
export function ToolLine({ icon: Icon, children }: { icon: LucideIcon; children: string }) {
  return (
    <div className="text-muted-foreground flex w-full items-center gap-2 overflow-hidden py-1">
      <Icon className="size-4 shrink-0" />
      <span className="truncate text-sm">{children}</span>
    </div>
  );
}
