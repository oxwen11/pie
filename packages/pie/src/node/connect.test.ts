import { describe, expect, it } from "vitest";

import {
  CONNECT_HINT,
  describeConnectFailure,
  endpointFromExplicitUrl,
  normalizeAddress,
} from "./connect";

const record = {
  address: "http://127.0.0.1:41234",
  token: "daemon-token",
};

describe("endpointFromExplicitUrl", () => {
  it("never consults the daemon record when PIE_AUTH_TOKEN is set", () => {
    expect(endpointFromExplicitUrl("http://127.0.0.1:41234/unused", "env-token", record)).toEqual({
      address: "http://127.0.0.1:41234",
      token: "env-token",
    });
  });

  it("reuses the live daemon token when the URL origin matches", () => {
    expect(endpointFromExplicitUrl("http://127.0.0.1:41234", undefined, record)).toEqual({
      address: "http://127.0.0.1:41234",
      token: "daemon-token",
    });
  });

  it("stays tokenless for an unauthenticated serve on another origin", () => {
    expect(endpointFromExplicitUrl("http://127.0.0.1:4180", undefined, record)).toEqual({
      address: "http://127.0.0.1:4180",
      token: undefined,
    });
  });

  it("stays tokenless when no daemon record is available", () => {
    expect(endpointFromExplicitUrl("http://127.0.0.1:4180", "", undefined)).toEqual({
      address: "http://127.0.0.1:4180",
      token: undefined,
    });
  });
});

describe("normalizeAddress", () => {
  it("strips a path so ticket and websocket URLs join cleanly", () => {
    expect(normalizeAddress("http://127.0.0.1:41234/ws/rpc")).toBe("http://127.0.0.1:41234");
  });
});

describe("describeConnectFailure", () => {
  it("points at PIE_AUTH_TOKEN when the ticket endpoint rejects the caller", () => {
    const error = describeConnectFailure(new Error("Failed to obtain a WebSocket ticket: 401"), {
      address: "http://127.0.0.1:41234",
      token: undefined,
    });
    expect(error.message).toContain("401");
    expect(error.message).toContain(CONNECT_HINT);
  });
});
