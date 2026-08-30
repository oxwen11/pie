/** Host-owned authenticated WebSocket behavior used by the shared app runtime. */
export type ServerConnection = {
  /** Open one socket; called again whenever the oRPC link reconnects. */
  readonly connectWebSocket: () => Promise<WebSocket>;
};
