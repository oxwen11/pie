import { Button } from "@getpie/ui/components/button";
import { FlaskConicalIcon } from "lucide-react";

import { useContentPanel, usePanelSnapshot } from "@/components/layout/content-panel/react/hooks";

import { PLUGIN_DEMO_TITLE, PLUGIN_DEMO_URL } from "./plugin-iframe";
import { pluginPanel } from "./plugin-panel";

/** Thin left rail: one dogfood Demo icon. Hidden off a session route. */
export function PluginActivityBar() {
  const session = useContentPanel();
  const activeId = usePanelSnapshot((snapshot) => snapshot.active?.id ?? null);
  const hidden = usePanelSnapshot((snapshot) => snapshot.presentation === "hidden");

  if (session === null) return null;

  const active = !hidden && activeId === pluginPanel.type;

  return (
    <nav
      aria-label="Plugin panels"
      className="border-sidebar-border flex h-full w-11 shrink-0 flex-col items-center border-e py-2"
      data-slot="plugin-activity-bar"
    >
      <Button
        aria-label="Demo"
        aria-pressed={active}
        data-state={active ? "active" : "inactive"}
        onClick={() => {
          session.open(pluginPanel, { title: PLUGIN_DEMO_TITLE, url: PLUGIN_DEMO_URL });
        }}
        size="icon-sm"
        title="Demo"
        variant={active ? "secondary" : "ghost"}
      >
        <FlaskConicalIcon />
      </Button>
    </nav>
  );
}
