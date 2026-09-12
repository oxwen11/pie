import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import {
  checkPiAvailability,
  resolvePiExecutable,
} from "../../../src/harness/pi/resolve-executable";
import { fakeExecutables } from "../../fake-file-system";

describe("resolvePiExecutable", () => {
  it("prefers the E2E override when PIE_E2E=1", () => {
    expect(
      resolvePiExecutable({
        PIE_E2E: "1",
        PIE_E2E_PI_EXECUTABLE: "/tmp/fake-pi",
        PIE_PI_EXECUTABLE: "/ignored",
      }),
    ).toEqual({ command: "/tmp/fake-pi" });
  });

  it("uses PIE_PI_EXECUTABLE in production", () => {
    expect(resolvePiExecutable({ PIE_PI_EXECUTABLE: "/opt/pi" })).toEqual({
      command: "/opt/pi",
    });
  });

  it("uses PATH pi when no executable override is set", () => {
    expect(resolvePiExecutable({})).toEqual({ command: "pi" });
  });
});

describe("checkPiAvailability", () => {
  it("reports PATH Pi missing when the command is not installed", () => {
    const result = Effect.runSync(
      checkPiAvailability({ command: "pi" }).pipe(Effect.provide(fakeExecutables())),
    );
    expect(result).toEqual({ available: false, reason: "Pi was not found on PATH." });
  });
});
