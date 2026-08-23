import { SidebarTrigger, useSidebar } from "@getpie/ui/components/sidebar";
import { cn } from "@getpie/ui/lib/utils";
import type { ReactElement } from "react";

import { desktopToggleLeftClass } from "@/components/layout/shell-chrome";
import { usePlatform } from "@/platform-context";
import { isDesktopHost } from "@/platform-host";

/** Desktop: viewport-fixed toggle hugging the left chrome (traffic lights on macOS). */
export function ShellSidebarToggle(): ReactElement | null {
  const { isMobile } = useSidebar();
  const platform = usePlatform();

  if (isMobile || !isDesktopHost(platform)) return null;

  return (
    <SidebarTrigger
      className={cn(
        "fixed top-1.5 z-50 [-webkit-app-region:no-drag]",
        desktopToggleLeftClass(platform),
      )}
    />
  );
}
