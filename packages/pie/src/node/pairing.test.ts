import {
  type DaemonEndpoint,
  DaemonProtocolUnsupportedError,
  type DaemonHandle,
} from "@getpie/server/daemon";
import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";

import { BrowserAccessRestartRequired, pairResidentDaemon } from "./pairing";

const handle: DaemonHandle = {
  address: "http://127.0.0.1:4000",
  port: 4000,
  token: "master-value",
  pid: 1234,
  protocolVersion: 2,
  reused: true,
};

describe("pairResidentDaemon", () => {
  it("mints through the one resolved resident daemon without resolving another", async () => {
    let resolutions = 0;
    const daemon = Effect.sync(() => {
      resolutions += 1;
      return handle;
    });
    const issue = vi.fn<
      (endpoint: DaemonEndpoint) => Effect.Effect<{ url: string; expiresInSeconds: number }>
    >((endpoint) => {
      expect(endpoint).toBe(handle);
      return Effect.succeed({
        url: "http://127.0.0.1:4000/pair#grant=one-time",
        expiresInSeconds: 60,
      });
    });

    const result = await Effect.runPromise(pairResidentDaemon(daemon, issue));

    expect(resolutions).toBe(1);
    expect(issue).toHaveBeenCalledTimes(1);
    expect(result.handle.pid).toBe(handle.pid);
  });

  it("maps a healthy legacy daemon to restart-required", async () => {
    const issue = () =>
      Effect.fail(
        new DaemonProtocolUnsupportedError({
          requiredVersion: 2,
        }),
      );
    const error = await Effect.runPromise(
      Effect.flip(pairResidentDaemon(Effect.succeed(handle), issue)),
    );
    expect(error).toBeInstanceOf(BrowserAccessRestartRequired);
  });
});
