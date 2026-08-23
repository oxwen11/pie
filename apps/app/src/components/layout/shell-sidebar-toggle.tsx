import { SidebarTrigger, useSidebar } from "@getpie/ui/components/sidebar";
import { cn } from "@getpie/ui/lib/utils";
import type { ReactElement } from "react";

import { usePlatform } from "@/platform-context";

/** Clears macOS traffic lights in the top chrome row (matches Electron `trafficLightPosition`). */
export const MACOS_TRAFFIC_LIGHTS_INSET = "ps-20" as const;

/** Clears macOS traffic lights plus the fixed sidebar toggle (size-7 + gap-2). */
export const MACOS_TITLEBAR_CHROME_INSET = "ps-[7.25rem]" as const;

/** Desktop macOS: fixed toggle to the right of native traffic lights. */
export function ShellSidebarToggle(): ReactElement | null {
  const { isMobile } = useSidebar();
  const { os } = usePlatform();

  if (isMobile || os !== "macos") return null;

  return (
    <SidebarTrigger
      className={cn(
        "absolute start-20 top-1.5 z-50 [-webkit-app-region:no-drag]",
      )}
    />
  );
}
