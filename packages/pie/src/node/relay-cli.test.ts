import fs from "node:fs";
import path from "node:path";
import url from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { parseHostPort, takeRelayToken } from "./relay-cli";

const here = import.meta.dirname;

describe("parseHostPort", () => {
  it("splits a public hop", () => {
    expect(parseHostPort("96.44.165.19:18443")).toEqual({ host: "96.44.165.19", port: 18443 });
  });

  it("rejects a missing port", () => {
    expect(() => parseHostPort("96.44.165.19")).toThrow(/host:port/);
  });
});

describe("takeRelayToken", () => {
  afterEach(() => {
    delete process.env.PIE_RELAY_TOKEN;
  });

  it("requires PIE_RELAY_TOKEN and removes it from the environment", () => {
    process.env.PIE_RELAY_TOKEN = "relay-token-test";
    expect(takeRelayToken()).toBe("relay-token-test");
    expect(process.env.PIE_RELAY_TOKEN).toBeUndefined();
  });

  it("fails closed when the token is missing", () => {
    delete process.env.PIE_RELAY_TOKEN;
    expect(() => takeRelayToken()).toThrow(/PIE_RELAY_TOKEN is required/);
  });
});

describe("standalone hop sources", () => {
  it("do not import the daemon or HTTP server", () => {
    const listen = fs.readFileSync(path.join(here, "relay-cli.ts"), "utf8");
    const bin = fs.readFileSync(path.join(here, "relay.ts"), "utf8");
    for (const src of [listen, bin]) {
      expect(src).not.toMatch(/@getpie\/server\/daemon/);
      expect(src).not.toMatch(/@getpie\/server\/http/);
    }
    expect(listen).toMatch(/@getpie\/server\/relay/);
  });
});
