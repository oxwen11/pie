import type { Contract } from "@getpie/contract";
import { createORPCClient } from "@orpc/client";
import { RPCLink as WebSocketRPCLink } from "@orpc/client/websocket";
import type { RouterContractClient } from "@orpc/contract";

/** A fully typed client for the Pie server, derived from the contract. */
export type PieClient = RouterContractClient<Contract>;

export type CreatePieClientOptions = {
  /** Open one authenticated socket. Re-invoked for every reconnect. */
  readonly connect?: () => Promise<WebSocket>;
};

function defaultConnect(): Promise<WebSocket> {
  const url = new URL("/ws/rpc", globalThis.location.origin);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return Promise.resolve(new WebSocket(url, "pie"));
}

/** Resolve the lazy socket factory so its reconnect behavior is testable. */
export function createWsConnect(options: CreatePieClientOptions = {}): () => Promise<WebSocket> {
  return options.connect ?? defaultConnect;
}

/**
 * WebSocket client: every call multiplexed over one connection. The link owns
 * reconnect timing while the host-owned connect behavior owns authentication.
 */
export function createPieClient(options: CreatePieClientOptions = {}): PieClient {
  const link = new WebSocketRPCLink({
    connect: createWsConnect(options),
    reconnect: { enabled: true },
  });
  return createORPCClient(link);
}
