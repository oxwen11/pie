import type { Contract } from "@getpie/contract";
import { createORPCClient, type ClientLink } from "@orpc/client";
import { RPCLink as WebSocketRPCLink } from "@orpc/client/websocket";
import type { RouterContractClient } from "@orpc/contract";

export type PieClientContext = {
  /** Client-side routing identity; servers do not receive this value. */
  readonly environmentId?: string;
};

/** A fully typed client for the Pie server, derived from the contract. */
export type PieClient = RouterContractClient<Contract, PieClientContext>;

export type PieLink = ClientLink<PieClientContext> & {
  dispose(): void;
};

export type CreatePieClientOptions = {
  /** WebSocket endpoint. Defaults to `/ws/rpc` on the current origin. */
  url?: string | URL;
  /** WebSocket subprotocol; the CLI server upgrades on "pie". */
  protocols?: string | string[];
  /**
   * Mint a single-use ticket for the handshake. A browser cannot set headers on
   * a WebSocket upgrade, so the bearer token can't travel with it; the desktop
   * renderer fetches a ticket over the authenticated HTTP link instead. The
   * link re-invokes `connect` on every reconnect, so each attempt gets a fresh
   * ticket. Omitted in browser mode, where the server requires none.
   */
  getTicket?: () => Promise<string>;
};

export type CloseablePieClient = {
  readonly client: PieClient;
  readonly close: () => void;
};

function defaultWsUrl(): URL {
  const location = (globalThis as { location?: { origin?: string } }).location;
  const url = new URL("/ws/rpc", location?.origin ?? "http://127.0.0.1");
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url;
}

/** Mint a single-use WebSocket ticket from a Pie HTTP endpoint. */
export async function getWsTicket(httpBaseUrl: string | URL, token?: string): Promise<string> {
  const response = await globalThis.fetch(new URL("/api/ws-ticket", httpBaseUrl), {
    method: "POST",
    ...(token === undefined ? undefined : { headers: { authorization: `Bearer ${token}` } }),
  });
  if (!response.ok) {
    throw new Error(`Failed to obtain a WebSocket ticket: ${response.status}`);
  }
  const body: unknown = await response.json();
  if (
    typeof body !== "object" ||
    body === null ||
    !("ticket" in body) ||
    typeof body.ticket !== "string" ||
    body.ticket.length === 0
  ) {
    throw new Error("WebSocket ticket response was empty");
  }
  return body.ticket;
}

/**
 * The link's `connect` factory. Exported so the ticket handshake is testable
 * without standing up a socket server.
 */
export function createWsConnect(options: CreatePieClientOptions): () => Promise<WebSocket> {
  return async () => {
    const url = new URL(options.url ?? defaultWsUrl());
    if (options.getTicket) {
      url.searchParams.set("ticket", await options.getTicket());
    }
    return new WebSocket(url, options.protocols ?? "pie");
  };
}

export function createPieLink(
  options: CreatePieClientOptions,
  reconnect = true,
  onConnect?: (socket: WebSocket) => void,
): PieLink {
  const connect = createWsConnect(options);
  const sockets = new Set<WebSocket>();
  let disposed = false;
  const link = new WebSocketRPCLink<PieClientContext>({
    connect: async () => {
      const socket = await connect();
      if (disposed) {
        socket.close();
        throw new Error("Pie link is disposed");
      }
      sockets.add(socket);
      socket.addEventListener("close", () => sockets.delete(socket), { once: true });
      onConnect?.(socket);
      return socket;
    },
    reconnect: { enabled: reconnect },
  });
  return Object.assign(link, {
    dispose() {
      disposed = true;
      for (const socket of sockets) socket.close();
      sockets.clear();
    },
  });
}

const createClient = (
  options: CreatePieClientOptions,
  reconnect: boolean,
  onConnect?: (socket: WebSocket) => void,
): PieClient => createORPCClient(createPieLink(options, reconnect, onConnect));

/**
 * WebSocket client: every call multiplexed over one connection. The link takes
 * a lazy `connect` factory, so the socket is opened on first use and each
 * reconnect fetches a fresh ticket.
 */
export function createPieClient(options: CreatePieClientOptions = {}): PieClient {
  return createClient(options, true);
}

/** One-shot client for short-lived processes that must close their socket. */
export function createCloseablePieClient(options: CreatePieClientOptions = {}): CloseablePieClient {
  let socket: WebSocket | undefined;
  return {
    client: createClient(options, false, (connected) => {
      socket = connected;
    }),
    close: () => {
      socket?.close();
    },
  };
}
