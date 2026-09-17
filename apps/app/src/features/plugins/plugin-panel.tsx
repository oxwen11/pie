import { FlaskConicalIcon } from "lucide-react";

import type { PanelHandle } from "@/components/layout/content-panel/model/panel";
import { definePanel } from "@/components/layout/content-panel/react/view";

import {
  type PluginIframePayload,
  parsePluginIframePayload,
  pluginIframeSrc,
} from "./plugin-iframe";

export const pluginPanel = definePanel({
  type: "plugin-iframe",
  label: "Demo",
  parse: parsePluginIframePayload,
  view: {
    icon: FlaskConicalIcon,
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
