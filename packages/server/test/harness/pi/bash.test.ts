import { describe, expect, it } from "vitest";

import { filterPiBashEnv } from "../../../src/harness/pi/bash";

const HOST_ENV: NodeJS.ProcessEnv = {
  PIE_DAEMON_DIR: "daemon-beta",
  PIE_HOME: "/tmp/pie-home",
  PIE_AUTH_TOKEN: "secret",
  ELECTRON_RUN_AS_NODE: "1",
  ELECTRON_RENDERER_PORT: "5173",
  PORT: "5173",
  VITE_DEV_SERVER_URL: "http://localhost:5173",
  PATH: "/usr/bin:/bin",
  HOME: "/users/test",
  DISPLAY: ":0",
  HTTPS_PROXY: "http://proxy.example:8080",
  FOO_KEEP: "keep-me",
  PI_SESSION_ID: "sess-1",
};

describe("filterPiBashEnv", () => {
  it("strips host identity and keeps OS, proxy, and PI session keys", () => {
    expect(filterPiBashEnv(HOST_ENV)).toEqual({
      PATH: "/usr/bin:/bin",
      HOME: "/users/test",
      DISPLAY: ":0",
      HTTPS_PROXY: "http://proxy.example:8080",
      FOO_KEEP: "keep-me",
      PI_SESSION_ID: "sess-1",
    });
  });
});
