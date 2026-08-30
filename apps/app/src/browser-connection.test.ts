import { describe, expect, it, vi } from "vitest";

import { createBrowserConnection, issueBrowserWebSocketTicket } from "./browser-connection";

describe("createBrowserConnection", () => {
  it("mints fresh cookie-authenticated access for every connection", async () => {
    let issued = 0;
    const opened: URL[] = [];
    const connection = createBrowserConnection({
      fetch: vi.fn<typeof fetch>(async () => {
        issued += 1;
        return Response.json({ ticket: `ticket-${issued}` });
      }),
      location: { origin: "http://127.0.0.1:4000" },
      openWebSocket: (url) => {
        opened.push(url);
        return {} as WebSocket;
      },
    });

    await connection.connectWebSocket();
    await connection.connectWebSocket();

    expect(opened).toHaveLength(2);
    for (const url of opened) {
      expect(url.protocol).toBe("ws:");
      expect(url.host).toBe("127.0.0.1:4000");
      expect(url.pathname).toBe("/ws/rpc");
      expect(url.searchParams.has("ticket")).toBe(true);
    }
    expect(opened[0]!.search).not.toBe(opened[1]!.search);
  });
});

describe("issueBrowserWebSocketTicket", () => {
  it("uses the HttpOnly browser session on every ticket request", async () => {
    let issued = 0;
    const fetcher = vi.fn<typeof fetch>(async (_input, init) => {
      issued += 1;
      expect(init).toMatchObject({
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
      });
      return Response.json({ ticket: `ticket-${issued}` }, { status: 200 });
    });

    await expect(issueBrowserWebSocketTicket(fetcher)).resolves.not.toBe(
      await issueBrowserWebSocketTicket(fetcher),
    );
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("does not include a refused response body in its error", async () => {
    const fetcher = vi.fn<typeof fetch>(
      async () => new Response("sensitive-response-marker", { status: 401 }),
    );
    const error = await issueBrowserWebSocketTicket(fetcher).catch((cause: unknown) => cause);
    expect(String(error)).not.toContain("sensitive-response-marker");
  });
});
