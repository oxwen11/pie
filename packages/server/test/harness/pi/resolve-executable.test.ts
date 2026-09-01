import path from "node:path";

import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import {
  checkPiAvailability,
  piAvailabilityTarget,
  resolvePiExecutable,
  resolvePiProcessEntry,
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

  it("spawns the pie Pi process via Node against dist/pi-process.mjs", () => {
    const entry = resolvePiProcessEntry();
    expect(entry.endsWith(`${path.sep}dist${path.sep}pi-process.mjs`)).toBe(true);
    expect(resolvePiExecutable({})).toEqual({
      command: process.execPath,
      prefixArgs: [entry],
    });
  });
});

describe("piAvailabilityTarget", () => {
  it("checks the script path when Pi is run under Node", () => {
    expect(
      piAvailabilityTarget({
        command: process.execPath,
        prefixArgs: ["/opt/pie/dist/pi-process.mjs"],
      }),
    ).toBe("/opt/pie/dist/pi-process.mjs");
  });

  it("checks the command name for PATH lookup", () => {
    expect(piAvailabilityTarget({ command: "pi", prefixArgs: [] })).toBe("pi");
  });
});

describe("checkPiAvailability", () => {
  it("reports the pie Pi process available when the script file exists", () => {
    const entry = resolvePiProcessEntry();

    const result = Effect.runSync(
      checkPiAvailability({ command: process.execPath, prefixArgs: [entry] }).pipe(
        Effect.provide(fakeStats({ [entry]: fileInfo("File", 0o644) })),
      ),
    );
    expect(result).toEqual({ available: true });
  });

  it("reports the pie Pi process missing when the script file is absent", () => {
    const result = Effect.runSync(
      checkPiAvailability({
        command: process.execPath,
        prefixArgs: ["/does/not/exist/pi-process.mjs"],
      }).pipe(Effect.provide(fakeStats({}))),
    );
    expect(result).toEqual({ available: false, reason: "Pie Pi process is missing." });
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
