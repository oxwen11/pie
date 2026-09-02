import { describe, expect, it } from "vitest";

import { expectLaunch, parseLaunchArgs, type LaunchCtx } from "./surface.ts";

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

describe("expectLaunch", () => {
  it("narrows a matching ctx and rejects a mismatch", () => {
    const ctx = {
      surface: "cli",
      repo: "/repo",
      runId: "run-1",
      runDir: "/tmp/run",
      pieHome: "/tmp/pie-home",
      piePort: 4182,
      request: { replace: false, mode: "daemon" },
      env: {},
      daemonDir: "/tmp/daemon",
    } satisfies Extract<LaunchCtx, { surface: "cli" }>;
    expect(expectLaunch(ctx, "cli").daemonDir).toBe("/tmp/daemon");
    expect(() => expectLaunch(ctx, "web")).toThrow(/expected web launch ctx/);
  });
});
