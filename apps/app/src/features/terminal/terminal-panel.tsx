import type { PieClient } from "@getpie/client";
import { TerminalIcon } from "lucide-react";
import { useEffect, useRef } from "react";

import { asRecord, type PanelHandle } from "@/components/layout/content-panel/model/panel";
import { definePanelFamily } from "@/components/layout/content-panel/react/view";

import { attachTerminalSurface } from "./surface";

import "@xterm/xterm/css/xterm.css";

interface TerminalPayload {
  readonly terminalId: string;
  /**
   * Shown on the tab. In the payload rather than the instance because the tab
   * strip labels a panel it has never activated — and a reload has to redraw
   * that strip before any instance exists.
   */
  readonly title: string;
}

type TerminalInstance = PanelHandle<TerminalPayload>;

let nextTerminal = 0;

export function createTerminalPanel(client: PieClient) {
  return definePanelFamily({
    type: "terminal",
    key: (payload: TerminalPayload) => payload.terminalId,
    label: (payload) => payload.title,
    title: "Terminal",
    newPayload: () => {
      const n = ++nextTerminal;
      const payload: TerminalPayload = {
        terminalId: crypto.randomUUID(),
        title: `zsh ${n}`,
      };
      return payload;
    },
    parse: (raw) => {
      const { terminalId, title } = asRecord(raw) ?? {};
      if (typeof terminalId !== "string") return null;
      return { terminalId, title: typeof title === "string" ? title : "Terminal" };
    },
    onClose: (sessionRef, payload) => {
      void client.terminal.close({
        ref: sessionRef,
        terminalId: payload.terminalId,
      });
    },
    view: {
      icon: TerminalIcon,
      render: (instance) => <TerminalPanelView instance={instance} client={client} />,
    },
  });
}

function TerminalPanelView({
  instance,
  client,
}: {
  instance: TerminalInstance;
  client: PieClient;
}) {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const surface = attachTerminalSurface(mount, {
      client,
      ref: instance.sessionRef,
      terminalId: instance.payload.terminalId,
      title: instance.payload.title,
    });
    return () => {
      surface.detach();
    };
  }, [client, instance]);

  return (
    <div
      ref={mountRef}
      className="bg-background h-full min-h-0 flex-1 overflow-hidden [&_.xterm]:h-full [&_.xterm-screen]:h-full"
    />
  );
}
