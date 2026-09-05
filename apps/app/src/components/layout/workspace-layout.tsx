import { Button } from "@getpie/ui/components/button";
import { Sheet, SheetHeader, SheetPopup, SheetTitle } from "@getpie/ui/components/sheet";
import { useIsMobile } from "@getpie/ui/hooks/use-media-query";
import { FilesIcon } from "lucide-react";
import { type ReactNode, useId, useLayoutEffect, useRef, useState } from "react";
import { Group, Separator } from "react-resizable-panels";

import { ResizablePanel } from "@/components/layout/resizable-panel";

const MIN_SPLIT_WIDTH = 24 * 16 + 6;

export type WorkspaceLayoutProps = {
  preview: ReactNode;
  tree: ReactNode;
  treeLabel: string;
  toolbar?: ReactNode;
};

export function WorkspaceLayout({
  preview,
  tree,
  treeLabel,
  toolbar,
}: WorkspaceLayoutProps): ReactNode {
  const isMobile = useIsMobile();
  const [isNarrow, setIsNarrow] = useState(false);
  const [treeOpen, setTreeOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const drawerId = useId();
  const overlayTrigger = toolbar === undefined;

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (container === null) return;

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
  const drawerTrigger = useDrawer ? (
    <Button
      aria-controls={drawerId}
      aria-expanded={treeOpen}
      aria-haspopup="dialog"
      aria-label={`Open file tree for ${treeLabel}`}
      className={overlayTrigger ? "absolute end-11 top-1.5 z-10" : undefined}
      onClick={() => setTreeOpen(true)}
      size="icon-xs"
      variant="ghost"
    >
      <FilesIcon className="size-3.5" />
    </Button>
  ) : null;

  return (
    <div ref={containerRef} className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
      {toolbar !== undefined ? (
        <div className="flex h-9 shrink-0 items-center gap-2 border-b px-2">
          {toolbar}
          {drawerTrigger}
        </div>
      ) : null}
      {useDrawer ? (
        <>
          {preview}
          {overlayTrigger ? drawerTrigger : null}
          <Sheet onOpenChange={setTreeOpen} open={treeOpen}>
            <SheetPopup className="w-[min(90vw,24rem)]" id={drawerId} side="right">
              <SheetHeader className="border-b p-3">
                <SheetTitle className="text-base">Project files</SheetTitle>
              </SheetHeader>
              <div className="flex min-h-0 flex-1">{tree}</div>
            </SheetPopup>
          </Sheet>
        </>
      ) : (
        <Group
          className="flex min-h-0 flex-1"
          orientation="horizontal"
          resizeTargetMinimumSize={{ coarse: 44, fine: 12 }}
        >
          <ResizablePanel className="flex min-w-0 flex-col" defaultSize="60%" minSize="12rem">
            {preview}
          </ResizablePanel>
          <Separator
            aria-label="Resize file tree"
            className="after:bg-border hover:after:bg-foreground/30 data-[separator=active]:after:bg-primary relative w-1.5 bg-transparent after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 data-[separator=active]:after:w-0.5"
          />
          <ResizablePanel
            className="flex min-w-0 flex-col"
            defaultSize="40%"
            maxSize="50%"
            minSize="12rem"
          >
            {tree}
          </ResizablePanel>
        </Group>
      )}
    </div>
  );
}
