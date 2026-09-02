import { Button } from "@getpie/ui/components/button";
import { Sheet, SheetHeader, SheetPopup, SheetTitle } from "@getpie/ui/components/sheet";
import { useIsMobile } from "@getpie/ui/hooks/use-media-query";
import { cn } from "@getpie/ui/lib/utils";
import { FilesIcon } from "lucide-react";
import {
  createContext,
  type ComponentProps,
  type ReactNode,
  use,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Group, Separator } from "react-resizable-panels";

import { ResizablePanel } from "@/components/layout/resizable-panel";

const MIN_SPLIT_WIDTH = 24 * 16 + 6;

type WorkspaceLayoutContextValue = {
  readonly useDrawer: boolean;
  readonly treeOpen: boolean;
  readonly setTreeOpen: (open: boolean) => void;
  readonly drawerId: string;
};

const WorkspaceLayoutContext = createContext<WorkspaceLayoutContextValue | null>(null);

function useWorkspaceLayout(): WorkspaceLayoutContextValue {
  const value = use(WorkspaceLayoutContext);
  if (value === null) {
    throw new Error("Workspace layout parts must be rendered inside WorkspaceLayout");
  }
  return value;
}

export type WorkspaceLayoutProps = {
  children: ReactNode;
};

export function WorkspaceLayout({ children }: WorkspaceLayoutProps): ReactNode {
  const isMobile = useIsMobile();
  const [isNarrow, setIsNarrow] = useState(false);
  const [treeOpen, setTreeOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const drawerId = useId();

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
  useLayoutEffect(() => {
    if (!useDrawer) setTreeOpen(false);
  }, [useDrawer]);

  const value = useMemo(
    () => ({ drawerId, setTreeOpen, treeOpen, useDrawer }),
    [drawerId, treeOpen, useDrawer],
  );

  return (
    <WorkspaceLayoutContext value={value}>
      <div ref={containerRef} className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        {children}
      </div>
    </WorkspaceLayoutContext>
  );
}

export type WorkspaceLayoutToolbarProps = ComponentProps<"div">;

export function WorkspaceLayoutToolbar({
  className,
  ...props
}: WorkspaceLayoutToolbarProps): ReactNode {
  return (
    <div
      className={cn("flex h-9 shrink-0 items-center gap-2 border-b px-2", className)}
      {...props}
    />
  );
}

export type WorkspaceLayoutBodyProps = {
  children: ReactNode;
};

export function WorkspaceLayoutBody({ children }: WorkspaceLayoutBodyProps): ReactNode {
  const { useDrawer } = useWorkspaceLayout();
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

export type WorkspaceLayoutPreviewProps = {
  children: ReactNode;
};

export function WorkspaceLayoutPreview({ children }: WorkspaceLayoutPreviewProps): ReactNode {
  const { useDrawer } = useWorkspaceLayout();
  if (useDrawer) return children;
  return (
    <ResizablePanel className="flex min-w-0 flex-col" defaultSize="60%" minSize="12rem">
      {children}
    </ResizablePanel>
  );
}

export type WorkspaceLayoutSeparatorProps = ComponentProps<typeof Separator>;

export function WorkspaceLayoutSeparator({
  className,
  ...props
}: WorkspaceLayoutSeparatorProps): ReactNode {
  const { useDrawer } = useWorkspaceLayout();
  if (useDrawer) return null;
  return (
    <Separator
      aria-label="Resize file tree"
      className={cn(
        "after:bg-border hover:after:bg-foreground/30 data-[separator=active]:after:bg-primary relative w-1.5 bg-transparent after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 data-[separator=active]:after:w-0.5",
        className,
      )}
      {...props}
    />
  );
}

export type WorkspaceLayoutTreeProps = {
  children: ReactNode;
};

export function WorkspaceLayoutTree({ children }: WorkspaceLayoutTreeProps): ReactNode {
  const { drawerId, setTreeOpen, treeOpen, useDrawer } = useWorkspaceLayout();
  if (useDrawer) {
    return (
      <Sheet onOpenChange={setTreeOpen} open={treeOpen}>
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
    <ResizablePanel
      className="flex min-w-0 flex-col"
      defaultSize="40%"
      maxSize="50%"
      minSize="12rem"
    >
      {children}
    </ResizablePanel>
  );
}

export type WorkspaceLayoutTreeTriggerProps = Omit<ComponentProps<typeof Button>, "children"> & {
  label: string;
};

export function WorkspaceLayoutTreeTrigger({
  className,
  label,
  ...props
}: WorkspaceLayoutTreeTriggerProps): ReactNode {
  const { drawerId, setTreeOpen, treeOpen, useDrawer } = useWorkspaceLayout();
  if (!useDrawer) return null;
  return (
    <Button
      size="icon-xs"
      variant="ghost"
      {...props}
      aria-controls={drawerId}
      aria-expanded={treeOpen}
      aria-haspopup="dialog"
      aria-label={`Open file tree for ${label}`}
      className={className}
      onClick={() => setTreeOpen(true)}
    >
      <FilesIcon className="size-3.5" />
    </Button>
  );
}
