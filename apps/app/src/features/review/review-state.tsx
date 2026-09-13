import { GitCompareIcon, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { PanelEmptyState } from "@/components/layout/panel-empty-state";

export function ReviewState({
  title,
  children,
  onRetry,
  icon = GitCompareIcon,
  prominentIcon = false,
}: {
  title: string;
  children: ReactNode;
  onRetry?: () => void;
  icon?: LucideIcon;
  prominentIcon?: boolean;
}) {
  return (
    <PanelEmptyState icon={icon} onRetry={onRetry} prominentIcon={prominentIcon} title={title}>
      {children}
    </PanelEmptyState>
  );
}
