import { describe, expect, it, vi } from "vitest";

import { createWsConnect, getWsTicket } from "./index";

describe("createWsConnect", () => {
  it("does not fetch a ticket until a connection is attempted", () => {
    const getTicket = vi.fn<() => Promise<string>>(async () => "ticket-1");

    createWsConnect({ url: "ws://127.0.0.1:4100/ws/rpc", getTicket });

    expect(getTicket).not.toHaveBeenCalled();
  });

  it("appends the fetched ticket to the socket URL", async () => {
    const opened: string[] = [];
    function FakeSocket(url: string | URL) {
      opened.push(url.toString());
    }
    vi.stubGlobal("WebSocket", FakeSocket);

    const connect = createWsConnect({
      url: "ws://127.0.0.1:4100/ws/rpc",
      getTicket: async () => "ticket-1",
    });
    await connect();

    expect(opened).toEqual(["ws://127.0.0.1:4100/ws/rpc?ticket=ticket-1"]);
    vi.unstubAllGlobals();
  });

  it("mints a fresh ticket on every reconnect, since a ticket is single-use", async () => {
    const opened: string[] = [];
    function FakeSocket(url: string | URL) {
      opened.push(url.toString());
    }
    vi.stubGlobal("WebSocket", FakeSocket);

    let issued = 0;
    const connect = createWsConnect({
      url: "ws://127.0.0.1:4100/ws/rpc",
      getTicket: async () => {
        issued += 1;
        return `ticket-${issued}`;
      },
    });
    await connect();
    await connect();

    expect(opened).toEqual([
      "ws://127.0.0.1:4100/ws/rpc?ticket=ticket-1",
      "ws://127.0.0.1:4100/ws/rpc?ticket=ticket-2",
    ]);
    vi.unstubAllGlobals();
  });

  it("opens the bare URL when no ticket is required (browser mode)", async () => {
    const opened: string[] = [];
    function FakeSocket(url: string | URL) {
      opened.push(url.toString());
    }
    vi.stubGlobal("WebSocket", FakeSocket);

    const connect = createWsConnect({ url: "ws://127.0.0.1:4100/ws/rpc" });
    await connect();

    expect(opened).toEqual(["ws://127.0.0.1:4100/ws/rpc"]);
    vi.unstubAllGlobals();
  });
});

describe("getWsTicket", () => {
  it("uses the bearer token and validates the response", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({ ticket: "ticket-1" }));
    vi.stubGlobal("fetch", fetch);

    await expect(getWsTicket("http://127.0.0.1:4100", "daemon-token")).resolves.toBe("ticket-1");
    expect(fetch).toHaveBeenCalledOnce();
    const [url, request] = fetch.mock.calls[0] ?? [];
    expect(url).toBeInstanceOf(URL);
    if (!(url instanceof URL)) throw new Error("expected ticket URL");
    expect(url.href).toBe("http://127.0.0.1:4100/api/ws-ticket");
    expect(request).toEqual({
      method: "POST",
      headers: { authorization: "Bearer daemon-token" },
    });
    vi.unstubAllGlobals();
  });
});
