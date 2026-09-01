import { describe, expect, it } from "vitest";

import { defaultSurfaceFromEnv, isSurface, parsePieVerifyArgv } from "./argv.ts";
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

  it("lets a default surface treat the first token as a command", () => {
    expect(parsePieVerifyArgv(["launch", "--serve"], { defaultSurface: "cli" })).toEqual({
      kind: "surface",
      surface: "cli",
      rest: ["launch", "--serve"],
    });
    expect(parsePieVerifyArgv(["--help"], { defaultSurface: "cli" })).toEqual({
      kind: "surface",
      surface: "cli",
      rest: ["--help"],
    });
  });

  it("still honors an explicit surface when a default is set", () => {
    expect(parsePieVerifyArgv(["desktop", "doctor"], { defaultSurface: "cli" })).toEqual({
      kind: "surface",
      surface: "desktop",
      rest: ["doctor"],
    });
  });

  it("rejects an unknown first token when no default surface is set", () => {
    expect(() => parsePieVerifyArgv(["launch"])).toThrow(VerifyError);
  });
});

describe("defaultSurfaceFromEnv", () => {
  it("reads VERIFY_PIE_DEFAULT_SURFACE only when it is a known surface", () => {
    expect(defaultSurfaceFromEnv({ VERIFY_PIE_DEFAULT_SURFACE: "cli" })).toBe("cli");
    expect(defaultSurfaceFromEnv({ VERIFY_PIE_DEFAULT_SURFACE: "pie" })).toBeUndefined();
    expect(defaultSurfaceFromEnv({})).toBeUndefined();
  });
});
