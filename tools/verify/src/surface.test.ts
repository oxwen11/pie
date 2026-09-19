import { describe, expect, it } from "vitest";

import { expectLaunch, parseLaunchArgs, type LaunchCtx } from "./surface.ts";

describe("parseLaunchArgs", () => {
  it("seeds UI projects by default and accepts an empty-project override", () => {
    const options = {
      allowEmptyProjects: true,
      usage: "pie-verify web launch [--replace] [--empty-projects]",
    };
    expect(parseLaunchArgs(["--replace"], options)).toEqual({
      replace: true,
      seedProject: true,
    });
    expect(parseLaunchArgs(["--empty-projects"], options)).toEqual({
      replace: false,
      seedProject: false,
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
    expect(() =>
      parseLaunchArgs(["--empty-projects"], {
        allowServe: true,
        usage: "pie-verify cli launch [--replace] [--serve]",
      }),
    ).toThrow(/unknown arg --empty-projects/);
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
    } satisfies Extract<LaunchCtx, { surface: "cli" }>;
    expect(expectLaunch(ctx, "cli").pieHome).toBe("/tmp/pie-home");
    expect(() => expectLaunch(ctx, "web")).toThrow(/expected web launch ctx/);
  });
});
