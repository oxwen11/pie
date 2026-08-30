import type { ServerConnection } from "@getpie/app";

import type { DesktopClient } from "./desktop-client";

type WebSocketAccessClient = Pick<DesktopClient["server"], "webSocketAccess">;

/** Stable renderer adapter; Main brokers a fresh single-use URL per reconnect. */
export function createDesktopConnection(client: {
  server: WebSocketAccessClient;
}): ServerConnection {
  return {
    connectWebSocket: async () => {
      const access = await client.server.webSocketAccess();
      return new WebSocket(access.url, "pie");
    },
  };
}
