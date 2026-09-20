import { useRouteContext } from "@tanstack/react-router";
import { PuzzleIcon } from "lucide-react";
import { useEffect, useRef } from "react";

import type { PanelHandle } from "@/components/layout/content-panel/model/panel";
import { definePanelFamily } from "@/components/layout/content-panel/react/view";

import {
  type PluginIframePayload,
  parsePluginIframePayload,
  pluginIframeSrc,
} from "./plugin-iframe";
import {
  attachPluginSessionBridge,
  createPluginMessagePort,
  type PluginMessagePort,
} from "./plugin-session-bridge";

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
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const portRef = useRef<PluginMessagePort | null>(null);
  const loadedRef = useRef(false);
  const { orpcClient } = useRouteContext({ from: "__root__" });
  const { projectId, sessionId } = instance.sessionRef;

  useEffect(() => {
    const iframe = iframeRef.current;
    if (iframe === null) return undefined;
    const port = createPluginMessagePort(iframe);
    portRef.current = port;
    if (loadedRef.current) port.markReady();
    const bridge = attachPluginSessionBridge({
      subscribe: (input, options) => orpcClient.agent.session.subscribe(input, options),
      ref: { projectId, sessionId },
      deliver: port.deliver,
    });
    return () => {
      bridge.detach();
      portRef.current = null;
    };
  }, [orpcClient, projectId, sessionId]);

  return (
    <iframe
      className="block min-h-0 w-full flex-1 border-0"
      onLoad={() => {
        loadedRef.current = true;
        portRef.current?.markReady();
      }}
      ref={iframeRef}
      sandbox="allow-scripts"
      src={pluginIframeSrc(instance.payload.url, instance.sessionRef)}
      title={instance.payload.title}
    />
  );
}
