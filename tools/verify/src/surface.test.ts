import { describe, expect, it } from "vitest";

import { parseLaunchArgs } from "./surface.ts";

describe("parseLaunchArgs", () => {
  it("accepts --replace", () => {
    expect(parseLaunchArgs(["--replace"], { usage: "pie-verify web launch [--replace]" })).toEqual({
      replace: true,
    });
  });

  it("accepts --serve only when allowed", () => {
    expect(
      parseLaunchArgs(["--serve"], {
        allowServe: true,
        usage: "pie-verify cli launch [--replace] [--serve]",
      }),
    ).toEqual({ replace: false, mode: "serve" });
    expect(() =>
      parseLaunchArgs(["--serve"], { usage: "pie-verify web launch [--replace]" }),
    ).toThrow(/unknown arg --serve/);
  });

  it("rejects unknown flags", () => {
    expect(() => parseLaunchArgs(["--nope"], { usage: "usage" })).toThrow(/unknown arg --nope/);
  });
});
