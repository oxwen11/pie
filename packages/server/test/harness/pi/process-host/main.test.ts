import childProcess from "node:child_process";

import { describe, expect, it } from "vitest";

import { parsePiProcessArgs, PI_PROCESS_USAGE } from "../../../../src/harness/pi/process-host/main";
import { resolvePiProcessEntry } from "../../../../src/harness/pi/resolve-executable";

describe("parsePiProcessArgs", () => {
  it("requires --session-id", () => {
    expect(parsePiProcessArgs([])).toEqual({ error: PI_PROCESS_USAGE });
  });

  it("reads session id and optional model flags", () => {
    expect(parsePiProcessArgs(["--session-id", "abc", "--provider", "p", "--model", "m"])).toEqual({
      sessionId: "abc",
      provider: "p",
      modelId: "m",
    });
  });
});

describe("pi-process entry", () => {
  it("loads the Pi package and prints usage when --session-id is missing", () => {
    const entry = resolvePiProcessEntry();
    const result = childProcess.spawnSync(process.execPath, [entry], { encoding: "utf8" });
    const combined = `${result.stdout}${result.stderr}`;
    expect(combined).not.toMatch(/ERR_MODULE_NOT_FOUND|Cannot find package/);
    expect(result.stderr).toMatch(/--session-id/);
    expect(result.status).not.toBe(0);
  });
});
