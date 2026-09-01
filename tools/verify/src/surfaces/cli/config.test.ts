import { describe, expect, it } from "vitest";

import { DEFAULT_ROOT, refuseReservedPort } from "./config.ts";

describe("DEFAULT_ROOT", () => {
  it("isolates under /tmp/pie-verify-cli", () => {
    expect(DEFAULT_ROOT).toBe("/tmp/pie-verify-cli");
  });
});

describe("refuseReservedPort", () => {
  it("rejects the user/desktop daemon port", () => {
    expect(() => refuseReservedPort(4000)).toThrow(/PIE_PORT=4000/);
  });

  it("rejects the web verify ports", () => {
    expect(() => refuseReservedPort(4180)).toThrow(/4180/);
    expect(() => refuseReservedPort(4190)).toThrow(/4190/);
  });

  it("allows the isolated CLI verify port", () => {
    expect(() => refuseReservedPort(4182)).not.toThrow();
  });
});
