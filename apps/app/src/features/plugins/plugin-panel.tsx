import { PuzzleIcon } from "lucide-react";

import type { PanelHandle } from "@/components/layout/content-panel/model/panel";
import { definePanelFamily } from "@/components/layout/content-panel/react/view";

import {
  type PluginIframePayload,
  parsePluginIframePayload,
  pluginIframeSrc,
} from "./plugin-iframe";

export const pluginPanel = definePanelFamily({
  type: "plugin-iframe",
  key: (payload) => payload.url,
  label: (payload) => payload.title,
  title: "Plugin",
  parse: parsePluginIframePayload,
  view: {
    icon: PuzzleIcon,
    render: (instance) => <PluginIframeView instance={instance} />,
  },
});

function PluginIframeView({ instance }: { instance: PanelHandle<PluginIframePayload> }) {
  return (
    <iframe
      className="block min-h-0 w-full flex-1 border-0"
      sandbox="allow-scripts"
      src={pluginIframeSrc(instance.payload.url, instance.sessionRef)}
      title={instance.payload.title}
    />
  );
}
