import { useSidebar } from "@getpie/ui/components/sidebar";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import type { ReactElement } from "react";

import { PanelToggleButton } from "@/components/layout/panel-toggle-button";

export function ShellSidebarToggle(): ReactElement {
  const { open, toggleSidebar } = useSidebar();
  return (
    <PanelToggleButton
      closeIcon={PanelLeftClose}
      label="Toggle Sidebar"
      onClick={toggleSidebar}
      open={open}
      openIcon={PanelLeftOpen}
    />
  );
}
