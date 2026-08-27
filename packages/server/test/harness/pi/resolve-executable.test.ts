import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import {
  checkPiAvailability,
  piAvailabilityTarget,
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

  it("uses PATH pi when no executable override is set", () => {
    expect(resolvePiExecutable({})).toEqual({ command: "pi", prefixArgs: [] });
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
  it("reports a Node-run Pi script available when the file exists", () => {
    const result = Effect.runSync(
      checkPiAvailability({ command: process.execPath, prefixArgs: ["/opt/pi/cli.js"] }).pipe(
        Effect.provide(fakeStats({ ["/opt/pi/cli.js"]: fileInfo("File", 0o644) })),
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
