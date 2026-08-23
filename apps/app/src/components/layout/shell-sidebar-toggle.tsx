import { SidebarTrigger, useSidebar } from "@getpie/ui/components/sidebar";
import { cn } from "@getpie/ui/lib/utils";
import type { ReactElement } from "react";

import {
  desktopToggleInsetClass,
  SHELL_TITLEBAR_ROW_CLASS,
  SHELL_TITLEBAR_TOP_CLASS,
} from "@/components/layout/shell-chrome";
import { usePlatform } from "@/platform-context";
import { isDesktopHost } from "@/platform-host";

/** Desktop: viewport-fixed sidebar toggle — brand lives in the expanded sidebar header. */
export function ShellSidebarToggle(): ReactElement | null {
  const { isMobile } = useSidebar();
  const platform = usePlatform();

  if (isMobile || !isDesktopHost(platform)) return null;

  return (
    <div
      className={cn(
        "pointer-events-none fixed inset-x-0 z-50 [-webkit-app-region:drag]",
        SHELL_TITLEBAR_TOP_CLASS,
        SHELL_TITLEBAR_ROW_CLASS,
      )}
    >
      <SidebarTrigger
        className={cn(
          "pointer-events-auto [-webkit-app-region:no-drag]",
          desktopToggleInsetClass(platform),
        )}
      />
    </div>
  );
}
