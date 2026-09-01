import path from "node:path";

import { describe, expect, it } from "vitest";

import { envPort, isSharedPieHome } from "./process.ts";

describe("envPort", () => {
  it("returns the fallback when unset", () => {
    const previous = process.env.VERIFY_PIE_CLI_TEST_PORT;
    delete process.env.VERIFY_PIE_CLI_TEST_PORT;
    try {
      expect(envPort("VERIFY_PIE_CLI_TEST_PORT", 4182)).toBe(4182);
    } finally {
      if (previous === undefined) {
        delete process.env.VERIFY_PIE_CLI_TEST_PORT;
      } else {
        process.env.VERIFY_PIE_CLI_TEST_PORT = previous;
      }
    }
  });

  it("rejects a non-integer port", () => {
    const previous = process.env.VERIFY_PIE_CLI_TEST_PORT;
    process.env.VERIFY_PIE_CLI_TEST_PORT = "nope";
    try {
      expect(() => envPort("VERIFY_PIE_CLI_TEST_PORT", 4182)).toThrow(
        /invalid VERIFY_PIE_CLI_TEST_PORT=nope/,
      );
    } finally {
      if (previous === undefined) {
        delete process.env.VERIFY_PIE_CLI_TEST_PORT;
      } else {
        process.env.VERIFY_PIE_CLI_TEST_PORT = previous;
      }
    }
  });
});

describe("isSharedPieHome", () => {
  it("flags the default user homes", () => {
    const home = process.env.HOME ?? "";
    expect(isSharedPieHome(path.join(home, ".pie"))).toBe(true);
    expect(isSharedPieHome(path.join(home, ".pie-dev"))).toBe(true);
    expect(isSharedPieHome("/tmp/pie-verify-cli/runs/x/pie-home")).toBe(false);
    expect(isSharedPieHome("/tmp/pie-verify-web/runs/x/pie-home")).toBe(false);
    expect(isSharedPieHome("/tmp/pie-verify-desktop/runs/x/pie-home")).toBe(false);
  });
});
