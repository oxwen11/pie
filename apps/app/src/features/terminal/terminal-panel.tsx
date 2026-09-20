import { TerminalIcon } from "lucide-react";
import { useEffect, useRef } from "react";

import { asRecord, type PanelHandle } from "@/components/layout/content-panel/model/panel";
import { definePanelFamily } from "@/components/layout/content-panel/react/view";
import { useEnvironmentOrpc } from "@/lib/environment-orpc";
import type { EnvironmentRpc } from "@/lib/environment-rpc";

import { attachTerminalSurface } from "./surface";

import "@xterm/xterm/css/xterm.css";

interface TerminalPayload {
  readonly terminalId: string;
}

type TerminalInstance = PanelHandle<TerminalPayload>;

export function createTerminalPanel(environmentRpc: EnvironmentRpc) {
  return definePanelFamily({
    type: "terminal",
    key: (payload: TerminalPayload) => payload.terminalId,
    label: () => "zsh",
    title: "Terminal",
    newPayload: () => ({ terminalId: crypto.randomUUID() }),
    parse: (raw) => {
      const { terminalId } = asRecord(raw) ?? {};
      if (typeof terminalId !== "string") return null;
      return { terminalId };
    },
    onClose: (sessionRef, payload) => {
      void environmentRpc.for(sessionRef.environmentId).terminal.close.call({
        ref: sessionRef.ref,
        terminalId: payload.terminalId,
      });
    },
    view: {
      icon: TerminalIcon,
      render: (instance) => <TerminalPanelView instance={instance} />,
    },
  });
}

function TerminalPanelView({ instance }: { instance: TerminalInstance }) {
  const mountRef = useRef<HTMLDivElement>(null);
  const orpc = useEnvironmentOrpc();

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return undefined;
    const surface = attachTerminalSurface(mount, {
      client: orpc,
      ref: instance.sessionRef.ref,
      terminalId: instance.payload.terminalId,
    });
    return () => {
      surface.detach();
    };
  }, [instance, orpc]);

  return (
    <div
      ref={mountRef}
      className="bg-card h-full min-h-0 flex-1 overflow-hidden [&_.xterm]:h-full [&_.xterm-screen]:h-full"
    />
  );
}
