import type { ServerConnection } from "./server-connection";

export async function issueBrowserWebSocketTicket(
  fetcher: typeof globalThis.fetch = globalThis.fetch,
): Promise<string> {
  const response = await fetcher("/api/ws-ticket", {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`Failed to obtain browser WebSocket access: ${response.status}`);
  }
  const body = (await response.json()) as unknown;
  if (
    body === null ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    typeof (body as Record<string, unknown>).ticket !== "string"
  ) {
    throw new Error("Failed to obtain browser WebSocket access: invalid response");
  }
  return (body as { readonly ticket: string }).ticket;
}

export type BrowserConnectionEnvironment = {
  readonly fetch: typeof globalThis.fetch;
  readonly location: Pick<Location, "origin">;
  readonly openWebSocket: (url: URL, protocols: string | string[]) => WebSocket;
};

export function createBrowserConnection(
  environment?: BrowserConnectionEnvironment,
): ServerConnection {
  const activeEnvironment = environment ?? {
    fetch: globalThis.fetch,
    location: globalThis.location,
    openWebSocket: (url: URL, protocols: string | string[]) => new WebSocket(url, protocols),
  };

  return {
    connectWebSocket: async () => {
      const ticket = await issueBrowserWebSocketTicket(activeEnvironment.fetch);
      const url = new URL("/ws/rpc", activeEnvironment.location.origin);
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      url.searchParams.set("ticket", ticket);
      return activeEnvironment.openWebSocket(url, "pie");
    },
  };
}
