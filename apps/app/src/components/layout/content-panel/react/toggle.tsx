import { PanelRight, SquarePlus } from "lucide-react";
import type { ReactNode } from "react";

import { PanelToggleButton } from "@/components/layout/panel-toggle-button";

import { useContentPanel, usePanelSnapshot } from "./hooks";

/** Renders nothing off a session — there is no panel to toggle. */
export function ContentPanelToggle({ className }: { readonly className?: string }): ReactNode {
  const session = useContentPanel();
  const presentation = usePanelSnapshot((snapshot) => snapshot.presentation);
  if (session === null) return null;
  return (
    <PanelToggleButton
      className={className}
      closeIcon={PanelRight}
      label="Toggle content panel"
      onClick={() => session.toggleVisibility()}
      open={presentation !== "hidden"}
      openIcon={SquarePlus}
    />
  );
}
