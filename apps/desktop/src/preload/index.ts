import { ipcRenderer } from "electron";

import { DESKTOP_PORT_CHANNEL, DESKTOP_PORT_READY } from "../shared/desktop-channel";

let rendererReady = false;
let queued: MessagePort | undefined;

function deliver(port: MessagePort): void {
  window.postMessage({ type: DESKTOP_PORT_CHANNEL }, "*", [port]);
}

ipcRenderer.on(DESKTOP_PORT_CHANNEL, (event) => {
  const [port] = event.ports;
  if (!port) return;
  if (rendererReady) {
    deliver(port);
    return;
  }
  queued = port;
});

window.addEventListener("message", (event) => {
  if (event.source !== window || event.data?.type !== DESKTOP_PORT_READY) return;
  rendererReady = true;
  if (!queued) return;
  const port = queued;
  queued = undefined;
  deliver(port);
});
