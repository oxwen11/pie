import { useSidebar } from "@getpie/ui/components/sidebar";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import type { ComponentProps, ReactElement } from "react";

import { PanelToggleButton } from "@/components/layout/panel-toggle-button";

export function ShellSidebarToggle(
  props: Omit<
    ComponentProps<typeof PanelToggleButton>,
    "closeIcon" | "label" | "open" | "openIcon"
  >,
): ReactElement {
  const { isMobile, open, openMobile, toggleSidebar } = useSidebar();
  return (
    <PanelToggleButton
      {...props}
      closeIcon={PanelLeftClose}
      label="Toggle Sidebar"
      onClick={(event) => {
        props.onClick?.(event);
        toggleSidebar();
      }}
      open={isMobile ? openMobile : open}
      openIcon={PanelLeftOpen}
    />
  );
}
