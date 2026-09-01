import { Exit, Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  DesktopBootstrapSchema,
  DesktopOsSchema,
  ServerConnectionSchema,
  ServerStatusSchema,
  ServerStatusSnapshotSchema,
  StatusSubscribeInputSchema,
} from "./desktop-rpc";

const accepts = <A>(schema: Schema.ConstraintDecoder<A>, value: unknown): boolean =>
  Exit.isSuccess(Schema.decodeUnknownExit(schema)(value));

describe("desktop RPC schemas", () => {
  it("parses valid wire payloads", () => {
    expect(Schema.decodeUnknownSync(ServerStatusSchema)("ready")).toBe("ready");
    expect(
      Schema.decodeUnknownSync(ServerStatusSnapshotSchema)({
        revision: 3,
        status: "reconnecting",
      }),
    ).toEqual({
      revision: 3,
      status: "reconnecting",
    });
    expect(
      Schema.decodeUnknownSync(ServerConnectionSchema)({
        httpBaseUrl: "http://127.0.0.1:4000",
        wsBaseUrl: "ws://127.0.0.1:4000",
        token: "abc",
      }),
    ).toEqual({
      httpBaseUrl: "http://127.0.0.1:4000",
      wsBaseUrl: "ws://127.0.0.1:4000",
      token: "abc",
    });
    expect(Schema.decodeUnknownSync(DesktopOsSchema)("linux")).toBe("linux");
    expect(
      Schema.decodeUnknownSync(DesktopBootstrapSchema)({
        status: "starting",
        statusRevision: 0,
        os: "macos",
      }),
    ).toEqual({
      status: "starting",
      statusRevision: 0,
      os: "macos",
    });
    expect(Schema.decodeUnknownSync(StatusSubscribeInputSchema)({ after: 12 })).toEqual({
      after: 12,
    });
  });

  it("rejects invalid wire payloads", () => {
    expect(accepts(ServerStatusSchema, "unknown")).toBe(false);
    expect(accepts(ServerStatusSnapshotSchema, { revision: -1, status: "ready" })).toBe(false);
    expect(
      accepts(ServerConnectionSchema, {
        httpBaseUrl: "http://127.0.0.1:4000",
        wsBaseUrl: "ws://127.0.0.1:4000",
        token: "",
      }),
    ).toBe(false);
    expect(accepts(StatusSubscribeInputSchema, { after: -1 })).toBe(false);
  });
});
