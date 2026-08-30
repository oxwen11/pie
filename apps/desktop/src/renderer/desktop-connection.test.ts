import { describe, expect, it, vi } from "vitest";

import { createDesktopConnection } from "./desktop-connection";

describe("createDesktopConnection", () => {
  it("asks Main for fresh WebSocket access on every reconnect", async () => {
    let issued = 0;
    const webSocketAccess = vi.fn<() => Promise<{ url: string }>>(async () => {
      issued += 1;
      return { url: `ws://127.0.0.1:4000/ws/rpc?ticket=fake-${issued}` };
    });
    const client = { server: { webSocketAccess } };
    const opened: string[] = [];
    function FakeWebSocket(url: string | URL) {
      opened.push(url.toString());
    }
    vi.stubGlobal("WebSocket", FakeWebSocket);

    const connection = createDesktopConnection(client);
    await connection.connectWebSocket();
    await connection.connectWebSocket();

    expect(webSocketAccess).toHaveBeenCalledTimes(2);
    expect(opened).toHaveLength(2);
    expect(opened[0]).not.toBe(opened[1]);
    vi.unstubAllGlobals();
  });
});
