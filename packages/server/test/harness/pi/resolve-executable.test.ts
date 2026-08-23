import path from "node:path";
import url from "node:url";

import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import {
  checkPiAvailability,
  piAvailabilityTarget,
  resolveBundledPiCli,
  resolvePiExecutable,
} from "../../../src/harness/pi/resolve-executable";
import { fakeExecutables, fakeStats, fileInfo } from "../../fake-file-system";

describe("resolvePiExecutable", () => {
  it("prefers the E2E override when PIE_E2E=1", () => {
    expect(
      resolvePiExecutable({
        PIE_E2E: "1",
        PIE_E2E_PI_EXECUTABLE: "/tmp/fake-pi",
        PIE_PI_EXECUTABLE: "/ignored",
      }),
    ).toEqual({ command: "/tmp/fake-pi", prefixArgs: [] });
  });

  it("uses PIE_PI_EXECUTABLE in production", () => {
    expect(resolvePiExecutable({ PIE_PI_EXECUTABLE: "/opt/pi" })).toEqual({
      command: "/opt/pi",
      prefixArgs: [],
    });
  });

  it("falls back to bundled pi-coding-agent via Node", () => {
    const bundled = resolveBundledPiCli();
    expect(bundled).toBeTruthy();
    expect(resolvePiExecutable({})).toEqual({
      command: process.execPath,
      prefixArgs: [bundled!],
    });
  });

  it("resolves the bundled cli from the workspace dependency graph", () => {
    const bundled = resolveBundledPiCli();
    const indexPath = url.fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"));
    expect(bundled).toBe(path.join(path.dirname(indexPath), "cli.js"));
  });
});

describe("piAvailabilityTarget", () => {
  it("checks the script path when Pi is run under Node", () => {
    expect(
      piAvailabilityTarget({ command: process.execPath, prefixArgs: ["/opt/pi/dist/cli.js"] }),
    ).toBe("/opt/pi/dist/cli.js");
  });

  it("checks the command name for PATH lookup", () => {
    expect(piAvailabilityTarget({ command: "pi", prefixArgs: [] })).toBe("pi");
  });
});

describe("checkPiAvailability", () => {
  it("reports bundled Pi available when the script file exists", () => {
    const bundled = resolveBundledPiCli();
    expect(bundled).toBeTruthy();

    const result = Effect.runSync(
      checkPiAvailability({ command: process.execPath, prefixArgs: [bundled!] }).pipe(
        Effect.provide(fakeStats({ [bundled!]: fileInfo("File", 0o644) })),
      ),
    );
    expect(result).toEqual({ available: true });
  });

  it("reports bundled Pi missing when the script file is absent", () => {
    const result = Effect.runSync(
      checkPiAvailability({
        command: process.execPath,
        prefixArgs: ["/does/not/exist/cli.js"],
      }).pipe(Effect.provide(fakeStats({}))),
    );
    expect(result).toEqual({ available: false, reason: "Bundled Pi is missing." });
  });

  it("reports PATH Pi missing when the command is not installed", () => {
    const result = Effect.runSync(
      checkPiAvailability({ command: "pi", prefixArgs: [] }).pipe(
        Effect.provide(fakeExecutables()),
      ),
    );
    expect(result).toEqual({ available: false, reason: "Pi was not found on PATH." });
  });
});
