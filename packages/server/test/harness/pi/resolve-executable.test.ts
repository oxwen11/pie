import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import {
  checkPiAvailability,
  piAvailabilityTarget,
  resolvePiExecutable,
} from "../../../src/harness/pi/resolve-executable";
import { fakeExecutables, fakeStats, fileInfo } from "../../fake-file-system";

const rpc = "/opt/pie/dist/pi-process/pi-process.js";

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

  it("spawns bun plus the pie-owned RPC entry", () => {
    expect(resolvePiExecutable({}, { resolveBundledCli: () => rpc })).toEqual({
      command: "bun",
      prefixArgs: [rpc],
    });
  });

  it("uses PIE_BUN as the command when that path exists", () => {
    expect(
      resolvePiExecutable({ PIE_BUN: process.execPath }, { resolveBundledCli: () => rpc }),
    ).toEqual({
      command: process.execPath,
      prefixArgs: [rpc],
    });
  });

  it("falls back to PATH bun when PIE_BUN is missing on disk", () => {
    expect(
      resolvePiExecutable({ PIE_BUN: "/does/not/exist/bun" }, { resolveBundledCli: () => rpc }),
    ).toEqual({
      command: "bun",
      prefixArgs: [rpc],
    });
  });

  it("lets a .js PIE_PI_EXECUTABLE override the bundled entry", () => {
    expect(
      resolvePiExecutable(
        { PIE_PI_EXECUTABLE: "/opt/custom/cli.js" },
        { resolveBundledCli: () => rpc },
      ),
    ).toEqual({ command: "bun", prefixArgs: ["/opt/custom/cli.js"] });
  });

  it("does not run a shebang PIE_PI_EXECUTABLE under bun", () => {
    expect(
      resolvePiExecutable({ PIE_PI_EXECUTABLE: "/usr/bin/pi" }, { resolveBundledCli: () => rpc }),
    ).toEqual({ command: "bun", prefixArgs: [rpc] });
  });

  it("returns bun with no script when pie-pi-process cannot be resolved", () => {
    expect(resolvePiExecutable({}, { resolveBundledCli: () => undefined })).toEqual({
      command: "bun",
      prefixArgs: [],
    });
  });
  it("rewrites a packaged asar pie-pi-process entry to asar.unpacked for bun", () => {
    const asarEntry =
      "/Applications/Pie.app/Contents/Resources/app.asar/node_modules/@getpie/server/dist/pi-process/pi-process.js";
    expect(resolvePiExecutable({}, { resolveBundledCli: () => asarEntry })).toEqual({
      command: "bun",
      prefixArgs: [
        "/Applications/Pie.app/Contents/Resources/app.asar.unpacked/node_modules/@getpie/server/dist/pi-process/pi-process.js",
      ],
    });
  });
});

describe("piAvailabilityTarget", () => {
  it("checks the script path when Pi is run under bun", () => {
    expect(piAvailabilityTarget({ command: "bun", prefixArgs: [rpc] })).toBe(rpc);
  });

  it("checks the command name for PATH lookup", () => {
    expect(piAvailabilityTarget({ command: "bun", prefixArgs: [] })).toBe("bun");
  });
});

describe("checkPiAvailability", () => {
  it("reports bun missing when bun is not on PATH", () => {
    const result = Effect.runSync(
      checkPiAvailability(
        { command: "bun", prefixArgs: [rpc] },
        { env: { PATH: "/usr/local/bin" }, platform: "linux" },
      ).pipe(Effect.provide(fakeStats({ [rpc]: fileInfo("File", 0o644) }))),
    );
    expect(result).toEqual({
      available: false,
      reason: "Bun was not found. Install Bun.",
    });
  });

  it("reports pie-pi-process missing when bun is present but the script is not", () => {
    const result = Effect.runSync(
      checkPiAvailability(
        { command: "bun", prefixArgs: [] },
        { env: { PATH: "/usr/local/bin" }, platform: "linux" },
      ).pipe(Effect.provide(fakeExecutables("/usr/local/bin/bun"))),
    );
    expect(result).toEqual({
      available: false,
      reason: "pie-pi-process entry was not found.",
    });
  });

  it("reports bun available when bun and pie-pi-process both exist", () => {
    const result = Effect.runSync(
      checkPiAvailability(
        { command: "bun", prefixArgs: [rpc] },
        { env: { PATH: "/usr/local/bin" }, platform: "linux" },
      ).pipe(
        Effect.provide(
          fakeStats({
            "/usr/local/bin/bun": fileInfo("File", 0o755),
            [rpc]: fileInfo("File", 0o644),
          }),
        ),
      ),
    );
    expect(result).toEqual({ available: true });
  });
});
