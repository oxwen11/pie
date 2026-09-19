import { Button } from "@getpie/ui/components/button";
import { useQuery } from "@tanstack/react-query";
import { useRouteContext } from "@tanstack/react-router";
import { PuzzleIcon } from "lucide-react";

import { useContentPanel, usePanelSnapshot } from "@/components/layout/content-panel/react/hooks";

import { pluginPanel } from "./plugin-panel";

/** Thin left rail: one icon per discovered pie panel plugin. Hidden off a session route. */
export function PluginActivityBar() {
  const session = useContentPanel();
  const { orpcQueryUtils } = useRouteContext({ from: "__root__" });
  const plugins = useQuery(orpcQueryUtils.plugin.list.queryOptions());
  const activeId = usePanelSnapshot((snapshot) => snapshot.active?.id ?? null);
  const hidden = usePanelSnapshot((snapshot) => snapshot.presentation === "hidden");

  if (session === null) return null;

  const items = plugins.data ?? [];
  if (items.length === 0) return null;

  return (
    <nav
      aria-label="Plugin panels"
      className="border-sidebar-border flex h-full w-11 shrink-0 flex-col items-center gap-1 border-e py-2"
      data-slot="plugin-activity-bar"
    >
      {items.map((plugin) => {
        const active = !hidden && activeId === `${pluginPanel.type}:${plugin.url}`;
        return (
          <Button
            aria-label={plugin.title}
            aria-pressed={active}
            data-state={active ? "active" : "inactive"}
            key={plugin.id}
            onClick={() => {
              session.open(pluginPanel, { title: plugin.title, url: plugin.url });
            }}
            size="icon-sm"
            title={plugin.title}
            variant={active ? "secondary" : "ghost"}
          >
            <PuzzleIcon />
          </Button>
        );
      })}
    </nav>
  );
}
