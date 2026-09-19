import { describe, expect, it } from "vitest";

import { isSurface, parsePieVerifyArgv, surfaceUsage } from "./argv.ts";
import { VerifyError } from "./runtime/fail.ts";

describe("isSurface", () => {
  it("accepts the three isolated verify surfaces", () => {
    expect(isSurface("web")).toBe(true);
    expect(isSurface("cli")).toBe(true);
    expect(isSurface("desktop")).toBe(true);
  });

  it("rejects product CLI names and bare commands", () => {
    expect(isSurface("pie")).toBe(false);
    expect(isSurface("launch")).toBe(false);
    expect(isSurface(undefined)).toBe(false);
  });
});

describe("parsePieVerifyArgv", () => {
  it("prints top-level help when no surface is given", () => {
    expect(parsePieVerifyArgv([])).toEqual({ kind: "help" });
    expect(parsePieVerifyArgv(["--help"])).toEqual({ kind: "help" });
  });

  it("routes an explicit surface and keeps the rest of argv", () => {
    expect(parsePieVerifyArgv(["web", "launch", "--replace"])).toEqual({
      kind: "surface",
      surface: "web",
      rest: ["launch", "--replace"],
    });
    expect(parsePieVerifyArgv(["cli", "run", "daemon", "status"])).toEqual({
      kind: "surface",
      surface: "cli",
      rest: ["run", "daemon", "status"],
    });
  });

  it("rejects an unknown first token", () => {
    expect(() => parsePieVerifyArgv(["launch"])).toThrow(VerifyError);
  });
});

describe("surfaceUsage", () => {
  it("lists env and does not advertise a browser forward", () => {
    expect(surfaceUsage("web")).toMatch(/pie-verify web env \[--export\]/);
    expect(surfaceUsage("desktop")).toMatch(/pie-verify desktop env \[--export\]/);
    expect(surfaceUsage("web")).not.toMatch(/\bbrowser\b/);
    expect(surfaceUsage("desktop")).not.toMatch(/\bbrowser\b/);
    expect(surfaceUsage("cli")).not.toMatch(/\benv\b/);
  });
});
