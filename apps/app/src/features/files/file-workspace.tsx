import type { ReactNode } from "react";

import {
  WorkspaceSplit,
  WorkspaceSplitPanels,
  WorkspaceSplitPrimary,
  WorkspaceSplitSecondary,
  WorkspaceSplitTrigger,
} from "@/components/layout/workspace-split";

/** Files panel: the tree trigger floats over the preview until the column is wide enough to dock. */
export function FileWorkspace({
  label,
  preview,
  tree,
}: {
  readonly label: string;
  readonly preview: ReactNode;
  readonly tree: ReactNode;
}) {
  return (
    <WorkspaceSplit label={label}>
      <WorkspaceSplitPanels>
        <WorkspaceSplitPrimary>
          {preview}
          <WorkspaceSplitTrigger className="absolute end-11 top-1.5 z-10" />
        </WorkspaceSplitPrimary>
        <WorkspaceSplitSecondary>{tree}</WorkspaceSplitSecondary>
      </WorkspaceSplitPanels>
    </WorkspaceSplit>
  );
}
