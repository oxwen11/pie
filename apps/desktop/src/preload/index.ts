import { ipcRenderer } from "electron";

import { DESKTOP_PORT_CHANNEL, DESKTOP_PORT_READY } from "../shared/desktop-channel";

type PreloadPortState = {
  ready: boolean;
  queued: MessagePort | undefined;
};

const portState: PreloadPortState = {
  ready: false,
  queued: undefined,
};

function deliver(port: MessagePort): void {
  window.postMessage({ type: DESKTOP_PORT_CHANNEL }, "*", [port]);
}

ipcRenderer.on(DESKTOP_PORT_CHANNEL, (event) => {
  const [port] = event.ports;
  if (!port) return;
  if (portState.ready) {
    deliver(port);
    return;
  }
  portState.queued = port;
});

window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  const data: unknown = event.data;
  if (typeof data !== "object" || data === null || !("type" in data)) return;
  if (data.type !== DESKTOP_PORT_READY) return;
  portState.ready = true;
  if (portState.queued === undefined) return;
  const port = portState.queued;
  portState.queued = undefined;
  deliver(port);
});
