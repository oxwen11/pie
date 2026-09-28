import { Button } from "@getpie/ui/components/button";
import { Sheet, SheetHeader, SheetPopup, SheetTitle } from "@getpie/ui/components/sheet";
import { useIsMobile } from "@getpie/ui/hooks/use-media-query";
import { FilesIcon } from "lucide-react";
import {
  createContext,
  use,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Group } from "react-resizable-panels";

import { PanelSeparator } from "@/components/layout/panel-separator";
import { ResizablePanel } from "@/components/layout/resizable-panel";

const MIN_SPLIT_WIDTH = 24 * 16 + 6;

interface WorkspaceSplitContextValue {
  readonly drawerId: string;
  readonly label: string;
  readonly secondaryOpen: boolean;
  readonly setSecondaryOpen: (open: boolean) => void;
  readonly useDrawer: boolean;
}

const WorkspaceSplitContext = createContext<WorkspaceSplitContextValue | null>(null);

function useWorkspaceSplit(): WorkspaceSplitContextValue {
  const value = use(WorkspaceSplitContext);
  if (value === null) {
    throw new Error("WorkspaceSplit components must render inside WorkspaceSplit");
  }
  return value;
}

export interface WorkspaceSplitProps {
  readonly children: ReactNode;
  /** Accessible name for the file-tree drawer trigger. */
  readonly label: string;
}

/** Width observer and drawer-vs-split state for a preview beside a file tree. */
export function WorkspaceSplit({ children, label }: WorkspaceSplitProps) {
  const isMobile = useIsMobile();
  const [isNarrow, setIsNarrow] = useState(false);
  const [secondaryOpen, setSecondaryOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const drawerId = useId();

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (container === null) return undefined;

    const updateWidth = (width: number): void => {
      setIsNarrow(width < MIN_SPLIT_WIDTH);
    };
    updateWidth(container.getBoundingClientRect().width);

    const observer = new ResizeObserver(([entry]) => {
      if (entry !== undefined) updateWidth(entry.contentRect.width);
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const useDrawer = isMobile || isNarrow;
  const value = useMemo(
    () => ({
      drawerId,
      label,
      secondaryOpen,
      setSecondaryOpen,
      useDrawer,
    }),
    [drawerId, label, secondaryOpen, useDrawer],
  );

  return (
    <WorkspaceSplitContext value={value}>
      <div ref={containerRef} className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        {children}
      </div>
    </WorkspaceSplitContext>
  );
}

/** Split region under any feature toolbar. A drawer renders the children in place. */
export function WorkspaceSplitPanels({ children }: { readonly children: ReactNode }) {
  const { useDrawer } = useWorkspaceSplit();
  if (useDrawer) return children;
  return (
    <Group
      className="flex min-h-0 flex-1"
      orientation="horizontal"
      resizeTargetMinimumSize={{ coarse: 44, fine: 12 }}
    >
      {children}
    </Group>
  );
}

export function WorkspaceSplitPrimary({ children }: { readonly children: ReactNode }) {
  const { useDrawer } = useWorkspaceSplit();
  if (useDrawer) return children;
  return (
    <ResizablePanel className="flex min-w-0 flex-col" defaultSize="60%" minSize="12rem">
      {children}
    </ResizablePanel>
  );
}

export function WorkspaceSplitSecondary({ children }: { readonly children: ReactNode }) {
  const { drawerId, secondaryOpen, setSecondaryOpen, useDrawer } = useWorkspaceSplit();
  if (useDrawer) {
    return (
      <Sheet onOpenChange={setSecondaryOpen} open={secondaryOpen}>
        <SheetPopup className="w-[min(90vw,24rem)]" id={drawerId} side="right">
          <SheetHeader className="border-b p-3">
            <SheetTitle className="text-base">Project files</SheetTitle>
          </SheetHeader>
          <div className="flex min-h-0 flex-1">{children}</div>
        </SheetPopup>
      </Sheet>
    );
  }
  return (
    <>
      <PanelSeparator label="Resize file tree" />
      <ResizablePanel
        className="flex min-w-0 flex-col"
        defaultSize="40%"
        maxSize="50%"
        minSize="12rem"
      >
        {children}
      </ResizablePanel>
    </>
  );
}

/** Drawer trigger. Renders nothing while the tree is docked beside the preview. */
export function WorkspaceSplitTrigger({ className }: { readonly className?: string }) {
  const { drawerId, label, secondaryOpen, setSecondaryOpen, useDrawer } = useWorkspaceSplit();
  if (!useDrawer) return null;
  return (
    <Button
      aria-controls={drawerId}
      aria-expanded={secondaryOpen}
      aria-label={`Open file tree for ${label}`}
      className={className}
      onClick={() => setSecondaryOpen(true)}
      size="icon-xs"
      variant="ghost"
    >
      <FilesIcon className="size-3.5" />
    </Button>
  );
}
