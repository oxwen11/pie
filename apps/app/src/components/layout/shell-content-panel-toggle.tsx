import type { ReactElement } from "react";

import { ContentPanelToggle } from "@/components/layout/content-panel/react/toggle";

/** Viewport-fixed content-panel toggle so opening the panel does not move the control. */
export function ShellContentPanelToggle(): ReactElement {
  return (
    <div className="pointer-events-none fixed end-5 top-1 z-50 flex h-10 items-center">
      <ContentPanelToggle className="pointer-events-auto [-webkit-app-region:no-drag]" />
    </div>
  );
}
