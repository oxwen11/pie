import { useRouterState } from "@tanstack/react-router";
import { createContext, use, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export function hasPageSidebar(
  matches: ReadonlyArray<{ readonly staticData: { readonly pageSidebar?: true } }>,
): boolean {
  return matches.some((match) => match.staticData.pageSidebar === true);
}

const PageSidebarContext = createContext<{
  readonly target: HTMLDivElement | null;
  readonly setTarget: (target: HTMLDivElement | null) => void;
} | null>(null);

/** Pages own their sidebar's state; the shell only owns its DOM placement. */
export function PageSidebarProvider({ children }: { readonly children: ReactNode }) {
  const [target, setTarget] = useState<HTMLDivElement | null>(null);
  const value = useMemo(() => ({ target, setTarget }), [target]);
  return <PageSidebarContext value={value}>{children}</PageSidebarContext>;
}

export function PageSidebarOutlet() {
  const context = use(PageSidebarContext);
  if (context === null) throw new Error("PageSidebarOutlet requires PageSidebarProvider");
  const { setTarget } = context;
  return (
    <div
      className="flex min-h-0 flex-1 flex-col overflow-hidden"
      data-slot="page-sidebar"
      ref={setTarget}
    />
  );
}

export function PageSidebar({ children }: { readonly children: ReactNode }) {
  const context = use(PageSidebarContext);
  const claimed = useRouterState({ select: ({ matches }) => hasPageSidebar(matches) });
  if (context === null) throw new Error("PageSidebar requires PageSidebarProvider");
  if (!claimed) {
    throw new Error("Route must set staticData.pageSidebar before rendering PageSidebar");
  }
  return context.target === null ? null : createPortal(children, context.target);
}
