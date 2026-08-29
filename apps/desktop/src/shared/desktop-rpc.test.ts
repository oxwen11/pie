import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  DesktopBootstrapSchema,
  DesktopOsSchema,
  ServerConnectionSchema,
  ServerStatusSchema,
  ServerStatusSnapshotSchema,
  StatusSubscribeInputSchema,
} from "./desktop-rpc";

describe("desktop RPC schemas", () => {
  it("parses valid wire payloads", () => {
    expect(ServerStatusSchema.parse("ready")).toBe("ready");
    expect(ServerStatusSnapshotSchema.parse({ revision: 3, status: "reconnecting" })).toEqual({
      revision: 3,
      status: "reconnecting",
    });
    expect(
      ServerConnectionSchema.parse({
        httpBaseUrl: "http://127.0.0.1:4000",
        wsBaseUrl: "ws://127.0.0.1:4000",
        token: "abc",
      }),
    ).toEqual({
      httpBaseUrl: "http://127.0.0.1:4000",
      wsBaseUrl: "ws://127.0.0.1:4000",
      token: "abc",
    });
    expect(DesktopOsSchema.parse("linux")).toBe("linux");
    expect(
      DesktopBootstrapSchema.parse({
        status: "starting",
        statusRevision: 0,
        os: "macos",
      }),
    ).toEqual({
      status: "starting",
      statusRevision: 0,
      os: "macos",
    });
    expect(StatusSubscribeInputSchema.parse({ after: 12 })).toEqual({ after: 12 });
  });

  it("rejects invalid wire payloads", () => {
    expect(ServerStatusSchema.safeParse("unknown").success).toBe(false);
    expect(ServerStatusSnapshotSchema.safeParse({ revision: -1, status: "ready" }).success).toBe(
      false,
    );
    expect(
      ServerConnectionSchema.safeParse({
        httpBaseUrl: "http://127.0.0.1:4000",
        wsBaseUrl: "ws://127.0.0.1:4000",
        token: "",
      }).success,
    ).toBe(false);
    expect(StatusSubscribeInputSchema.safeParse({ after: -1 }).success).toBe(false);
  });

  it("compiles every object schema used on the wire", () => {
    // { strict: true } throws if the AOT fast path cannot be built.
    expect(() => z.compile(ServerStatusSnapshotSchema, { strict: true })).not.toThrow();
    expect(() => z.compile(ServerConnectionSchema, { strict: true })).not.toThrow();
    expect(() => z.compile(DesktopBootstrapSchema, { strict: true })).not.toThrow();
    expect(() => z.compile(StatusSubscribeInputSchema, { strict: true })).not.toThrow();
  });
});
