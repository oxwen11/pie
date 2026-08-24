import { SidebarTrigger, useSidebar } from "@getpie/ui/components/sidebar";
import type { ReactElement } from "react";

import { usePlatform } from "@/platform-context";
import { isDesktopHost } from "@/platform-host";

/** Desktop: viewport-fixed sidebar toggle — brand lives in the expanded sidebar header. */
export function ShellSidebarToggle(): ReactElement | null {
  const { isMobile } = useSidebar();
  const platform = usePlatform();

  if (isMobile || !isDesktopHost(platform)) return null;

  return (
    <div className="pointer-events-none fixed start-[var(--shell-controls-left)] top-1.5 z-50 flex h-10 items-center">
      <SidebarTrigger className="pointer-events-auto [-webkit-app-region:no-drag]" />
    </div>
  );
}
