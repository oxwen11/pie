import { Button } from "@getpie/ui/components/button";
import { Empty, EmptyContent, EmptyDescription } from "@getpie/ui/components/empty";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "@getpie/ui/components/menu";
import { cn } from "@getpie/ui/lib/utils";
import { Maximize2Icon, Minimize2Icon, PlusIcon, XIcon } from "lucide-react";
import { type ComponentProps, useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

import type { OpenPanel } from "../model/content-panel";
import { type ContentPanelSession, useContentPanel, usePanelSnapshot } from "./hooks";
import type { AnyPanelView } from "./view";

/**
 * The active content panel, tab strip and empty state. Knows nothing about any
 * particular panel — everything it shows comes off the snapshot. The shared
 * shell frame owns the outer border and corners; this column owns its content.
 */
export type ContentPanelOutletProps = ComponentProps<"aside"> & {
  /** Titlebar slot the tab strip portals into; nothing renders until it mounts. */
  readonly tabStripTarget: HTMLElement | null;
};

export function ContentPanelOutlet({
  className,
  tabStripTarget,
  ...props
}: ContentPanelOutletProps): ReactNode {
  const presentation = usePanelSnapshot((snapshot) => snapshot.presentation);
  const session = useContentPanel();

  // Off a session the snapshot is always hidden, so the first clause covers it;
  // the second is what narrows `session` for everything below.
  if (presentation === "hidden" || session === null) return null;

  return (
    <aside
      data-slot="content-panel"
      data-state={presentation}
      className={cn(
        "bg-card relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden",
        className,
      )}
      {...props}
    >
      {tabStripTarget === null
        ? null
        : createPortal(<TabStrip presentation={presentation} session={session} />, tabStripTarget)}
      <PanelBody session={session} />
    </aside>
  );
}

function TabStrip({
  presentation,
  session,
}: {
  presentation: "docked" | "maximized";
  session: ContentPanelSession;
}): ReactNode {
  const panels = usePanelSnapshot((snapshot) => snapshot.panels);
  const activeId = usePanelSnapshot((snapshot) => snapshot.active?.id ?? null);
  const scroller = useRef<HTMLDivElement>(null);

  // One effect here rather than one per tab: a scroll offset is not state to
  // derive, and the strip overflows well before it runs out of panels, so
  // without this the tab you just opened can land off the end of it.
  useEffect(() => {
    if (activeId === null) return;
    scroller.current
      ?.querySelector("[data-slot=content-panel-tab][data-active]")
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeId]);

  return (
    <div className="flex h-full min-w-0 flex-1 items-center gap-1 overflow-hidden ps-1.5">
      {/*
       * The scroller sizes to its content and shrinks — it is deliberately not
       * `flex-1`. "+" is its sibling, so it stays pinned just past the last
       * visible tab instead of scrolling off the end with them. `scrollbar-hide`
       * because a bar here would eat the height it scrolls in.
       */}
      <div
        ref={scroller}
        className="scrollbar-hide flex min-w-0 items-center gap-1 overflow-x-auto"
      >
        {panels.map((panel) => (
          <Tab key={panel.id} panel={panel} active={panel.id === activeId} session={session} />
        ))}
      </div>
      {panels.length > 0 ? <AddPanelMenu session={session} /> : null}
      <Button
        className="ms-auto"
        variant="ghost"
        size="icon-xs"
        aria-label={presentation === "maximized" ? "Restore panel size" : "Maximize panel"}
        onClick={() =>
          session.setPresentation(presentation === "maximized" ? "docked" : "maximized")
        }
      >
        {presentation === "maximized" ? (
          <Minimize2Icon className="size-3.5" />
        ) : (
          <Maximize2Icon className="size-3.5" />
        )}
      </Button>
      {/*
       * No hide button here: the shell-fixed `ContentPanelToggle` already is
       * one, and it has to live outside the panel anyway to bring it back. Two
       * controls for one boolean is the duplication that button would be.
       */}
    </div>
  );
}

function Tab({
  panel,
  active,
  session,
}: {
  panel: OpenPanel<AnyPanelView>;
  active: boolean;
  session: ContentPanelSession;
}): ReactNode {
  const Icon = panel.view.icon;
  return (
    <div
      data-slot="content-panel-tab"
      // `data-active`, as both `tabs` and `sidebar` spell it. Also how the strip
      // finds the tab to scroll into view.
      data-active={active || undefined}
      // Browser-style tabs: a fixed width that shrinks before the strip scrolls,
      // and a raised card surface for the current one.
      className={cn(
        "group/tab flex h-8 w-60 min-w-24 shrink items-center gap-1 rounded-lg ps-2.5 pe-1.5 text-sm",
        active
          ? "bg-card text-foreground ring-border shadow-xs ring-1"
          : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
      )}
      // A middle click closes the tab, the way every tabbed thing does.
      onAuxClick={(event) => {
        if (event.button !== 1) return;
        event.preventDefault();
        session.close(panel.id);
      }}
    >
      <button
        type="button"
        // Which tab is current must not be carried by the background alone.
        aria-current={active || undefined}
        className="flex min-w-0 flex-1 items-center gap-1.5"
        onClick={() => session.activate(panel.id)}
        title={panel.label}
      >
        <Icon className="size-4 shrink-0" />
        <span className="truncate">{panel.label}</span>
      </button>
      <button
        type="button"
        className="text-muted-foreground hover:bg-muted hover:text-foreground flex size-5 shrink-0 items-center justify-center rounded-md opacity-0 group-focus-within/tab:opacity-100 group-hover/tab:opacity-100 focus-visible:opacity-100"
        aria-label={`Close ${panel.label}`}
        onClick={() => session.close(panel.id)}
      >
        <XIcon className="size-3.5" />
      </button>
    </div>
  );
}

function AddPanelMenu({ session }: { session: ContentPanelSession }): ReactNode {
  const openable = usePanelSnapshot((snapshot) => snapshot.openable);
  if (openable.length === 0) return null;

  return (
    <Menu>
      <MenuTrigger
        className="text-muted-foreground hover:bg-accent hover:text-foreground inline-flex size-6 shrink-0 items-center justify-center rounded-md"
        aria-label="Open a panel"
      >
        <PlusIcon className="size-3.5" />
      </MenuTrigger>
      <MenuPopup align="start" side="bottom" sideOffset={6} className="min-w-44">
        {openable.map((entry) => {
          const Icon = entry.view.icon;
          return (
            <MenuItem key={entry.type} onClick={() => session.openNew(entry.type)}>
              <Icon className="size-4" />
              {entry.title}
            </MenuItem>
          );
        })}
      </MenuPopup>
    </Menu>
  );
}

function PanelBody({ session }: { session: ContentPanelSession }): ReactNode {
  const active = usePanelSnapshot((snapshot) => snapshot.active);
  if (active === null) return <EmptyState session={session} />;
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {/* Reading `instance` is what materializes the panel — only this one. */}
      {active.view.render(active.instance)}
    </div>
  );
}

function EmptyState({ session }: { session: ContentPanelSession }): ReactNode {
  const openable = usePanelSnapshot((snapshot) => snapshot.openable);
  return (
    <Empty className="py-6 md:py-6">
      <EmptyContent>
        <EmptyDescription>Choose what to show alongside the chat.</EmptyDescription>
        {/*
         * Ghost buttons, not bordered tiles: this is already inside the panel's
         * card, and cards do not nest (design.md). The published Button carries
         * the hover, focus ring and coarse-pointer step for free.
         */}
        <div className="grid w-full grid-cols-2 gap-1">
          {openable.map((entry) => {
            const Icon = entry.view.icon;
            return (
              <Button
                key={entry.type}
                variant="ghost"
                className="justify-start"
                onClick={() => session.openNew(entry.type)}
              >
                <Icon />
                {entry.title}
              </Button>
            );
          })}
        </div>
      </EmptyContent>
    </Empty>
  );
}
