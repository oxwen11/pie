import type { PieClient } from "@getpie/client";
import { useRouteContext } from "@tanstack/react-router";
import { TerminalIcon } from "lucide-react";
import { useEffect, useRef } from "react";

import { asRecord, type PanelHandle } from "@/components/layout/content-panel/model/panel";
import { definePanelFamily } from "@/components/layout/content-panel/react/view";

import { attachTerminalSurface } from "./surface";

import "@xterm/xterm/css/xterm.css";

interface TerminalPayload {
  readonly terminalId: string;
}

type TerminalInstance = PanelHandle<TerminalPayload>;

export function createTerminalPanel(client: PieClient) {
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
      void client.terminal.close({
        ref: sessionRef,
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
  const { orpcClient } = useRouteContext({ from: "__root__" });

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return undefined;
    const surface = attachTerminalSurface(mount, {
      client: orpcClient,
      ref: instance.sessionRef,
      terminalId: instance.payload.terminalId,
    });
    return () => {
      surface.detach();
    };
  }, [instance, orpcClient]);

  return (
    <div
      ref={mountRef}
      className="bg-card h-full min-h-0 flex-1 overflow-hidden [&_.xterm]:h-full [&_.xterm-screen]:h-full"
    />
  );
}
