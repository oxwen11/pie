import { describe, expect, it, vi } from "vitest";

import { createWsConnect } from "./index";

describe("createWsConnect", () => {
  it("does not open a socket until a connection is attempted", () => {
    const injected = vi.fn<() => Promise<WebSocket>>(async () => ({}) as WebSocket);
    createWsConnect({ connect: injected });
    expect(injected).not.toHaveBeenCalled();
  });

  it("uses the injected socket for the initial connection", async () => {
    const socket = {} as WebSocket;
    const injected = vi.fn<() => Promise<WebSocket>>(async () => socket);
    const connect = createWsConnect({ connect: injected });
    await expect(connect()).resolves.toBe(socket);
    expect(injected).toHaveBeenCalledTimes(1);
  });

  it("re-invokes the injected behavior for every reconnect", async () => {
    const first = {} as WebSocket;
    const second = {} as WebSocket;
    const injected = vi
      .fn<() => Promise<WebSocket>>()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);
    const connect = createWsConnect({ connect: injected });
    await expect(connect()).resolves.toBe(first);
    await expect(connect()).resolves.toBe(second);
    expect(injected).toHaveBeenCalledTimes(2);
  });
});
