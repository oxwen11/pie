import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import {
  checkPiAvailability,
  parsePiRuntime,
  piAvailabilityTarget,
  resolvePiExecutable,
  resolvePiRpcEntry,
} from "../../../src/harness/pi/resolve-executable";
import { fakeExecutables, fakeStats, fileInfo } from "../../fake-file-system";

describe("parsePiRuntime", () => {
  it("defaults to node when unset or empty", () => {
    expect(parsePiRuntime(undefined)).toBe("node");
    expect(parsePiRuntime("")).toBe("node");
    expect(parsePiRuntime("node")).toBe("node");
    expect(parsePiRuntime(" NODE ")).toBe("node");
  });

  it("selects bun case-insensitively", () => {
    expect(parsePiRuntime("bun")).toBe("bun");
    expect(parsePiRuntime("BUN")).toBe("bun");
    expect(parsePiRuntime(" bun ")).toBe("bun");
  });

  it("treats unknown values as node so the default spawn path stays unchanged", () => {
    expect(parsePiRuntime("deno")).toBe("node");
  });
});

describe("resolvePiExecutable", () => {
  it("prefers the E2E override when PIE_E2E=1", () => {
    expect(
      resolvePiExecutable({
        PIE_E2E: "1",
        PIE_E2E_PI_EXECUTABLE: "/tmp/fake-pi",
        PIE_PI_EXECUTABLE: "/ignored",
        PIE_PI_RUNTIME: "bun",
      }),
    ).toEqual({ command: "/tmp/fake-pi", prefixArgs: [] });
  });

  it("uses PIE_PI_EXECUTABLE in production", () => {
    expect(resolvePiExecutable({ PIE_PI_EXECUTABLE: "/opt/pi" })).toEqual({
      command: "/opt/pi",
      prefixArgs: [],
    });
  });

  it("falls back to the pie-owned RPC entry via Node", () => {
    const bundled = resolvePiRpcEntry();
    expect(bundled).toBeTruthy();
    if (bundled === undefined) {
      throw new Error("expected bundled RPC entry");
    }
    expect(resolvePiExecutable({})).toEqual({
      command: process.execPath,
      prefixArgs: [bundled],
    });
  });

  it("keeps the Node spawn path when PIE_PI_RUNTIME is node", () => {
    const bundled = resolvePiRpcEntry();
    expect(bundled).toBeTruthy();
    if (bundled === undefined) {
      throw new Error("expected bundled RPC entry");
    }
    expect(resolvePiExecutable({ PIE_PI_RUNTIME: "node" })).toEqual({
      command: process.execPath,
      prefixArgs: [bundled],
    });
  });

  it("spawns bun plus the RPC entry when PIE_PI_RUNTIME=bun", () => {
    const bundled = resolvePiRpcEntry();
    expect(bundled).toBeTruthy();
    if (bundled === undefined) {
      throw new Error("expected bundled RPC entry");
    }
    expect(resolvePiExecutable({ PIE_PI_RUNTIME: "bun" })).toEqual({
      command: "bun",
      prefixArgs: [bundled],
    });
  });

  it("lets a .js PIE_PI_EXECUTABLE override the bundled cli under bun", () => {
    expect(
      resolvePiExecutable({
        PIE_PI_RUNTIME: "bun",
        PIE_PI_EXECUTABLE: "/opt/custom/cli.js",
      }),
    ).toEqual({ command: "bun", prefixArgs: ["/opt/custom/cli.js"] });
  });

  it("does not run a shebang PIE_PI_EXECUTABLE under bun", () => {
    const bundled = resolvePiRpcEntry();
    expect(bundled).toBeTruthy();
    if (bundled === undefined) {
      throw new Error("expected bundled RPC entry");
    }
    expect(
      resolvePiExecutable({
        PIE_PI_RUNTIME: "bun",
        PIE_PI_EXECUTABLE: "/usr/bin/pi",
      }),
    ).toEqual({ command: "bun", prefixArgs: [bundled] });
  });

  it("returns bun with no script when the RPC entry cannot be resolved", () => {
    expect(
      resolvePiExecutable({ PIE_PI_RUNTIME: "bun" }, { resolveBundledCli: () => undefined }),
    ).toEqual({ command: "bun", prefixArgs: [] });
  });
});

describe("piAvailabilityTarget", () => {
  it("checks the script path when Pi is run under Node", () => {
    expect(
      piAvailabilityTarget({ command: process.execPath, prefixArgs: ["/opt/pi/dist/cli.js"] }),
    ).toBe("/opt/pi/dist/cli.js");
  });

  it("checks the script path when Pi is run under bun", () => {
    expect(piAvailabilityTarget({ command: "bun", prefixArgs: ["/opt/pi/dist/cli.js"] })).toBe(
      "/opt/pi/dist/cli.js",
    );
  });

  it("checks the command name for PATH lookup", () => {
    expect(piAvailabilityTarget({ command: "pi", prefixArgs: [] })).toBe("pi");
  });
});

describe("checkPiAvailability", () => {
  it("reports bundled Pi available when the script file exists", () => {
    const bundled = resolvePiRpcEntry();
    expect(bundled).toBeTruthy();
    if (bundled === undefined) {
      throw new Error("expected bundled RPC entry");
    }

    const result = Effect.runSync(
      checkPiAvailability({ command: process.execPath, prefixArgs: [bundled] }).pipe(
        Effect.provide(fakeStats({ [bundled]: fileInfo("File", 0o644) })),
      ),
    );
    expect(result).toEqual({ available: true });
  });

  it("reports the RPC entry missing when the script file is absent", () => {
    const result = Effect.runSync(
      checkPiAvailability({
        command: process.execPath,
        prefixArgs: ["/does/not/exist/pi-rpc.mjs"],
      }).pipe(Effect.provide(fakeStats({}))),
    );
    expect(result).toEqual({ available: false, reason: "Pie's Pi RPC entry is missing." });
  });

  it("reports the RPC entry missing when Node has no script to run", () => {
    const result = Effect.runSync(
      checkPiAvailability({ command: process.execPath, prefixArgs: [] }).pipe(
        Effect.provide(fakeExecutables()),
      ),
    );
    expect(result).toEqual({ available: false, reason: "Pie's Pi RPC entry is missing." });
  });

  it("reports bun missing on PATH when PIE_PI_RUNTIME selected bun", () => {
    const result = Effect.runSync(
      checkPiAvailability(
        { command: "bun", prefixArgs: ["/opt/pi/dist/cli.js"] },
        { env: { PATH: "/usr/local/bin" }, platform: "linux" },
      ).pipe(Effect.provide(fakeStats({ "/opt/pi/dist/cli.js": fileInfo("File", 0o644) }))),
    );
    expect(result).toEqual({
      available: false,
      reason: "Bun was not found on PATH. Install Bun or unset PIE_PI_RUNTIME.",
    });
  });

  it("reports cli.js missing when bun is present but the script is not", () => {
    const result = Effect.runSync(
      checkPiAvailability(
        { command: "bun", prefixArgs: [] },
        { env: { PATH: "/usr/local/bin" }, platform: "linux" },
      ).pipe(Effect.provide(fakeExecutables("/usr/local/bin/bun"))),
    );
    expect(result).toEqual({
      available: false,
      reason:
        "Pi RPC entry was not found. PIE_PI_RUNTIME=bun needs the script entry, not a shebang binary.",
    });
  });

  it("reports bun available when bun and cli.js both exist", () => {
    const result = Effect.runSync(
      checkPiAvailability(
        { command: "bun", prefixArgs: ["/opt/pi/dist/cli.js"] },
        { env: { PATH: "/usr/local/bin" }, platform: "linux" },
      ).pipe(
        Effect.provide(
          fakeStats({
            "/usr/local/bin/bun": fileInfo("File", 0o755),
            "/opt/pi/dist/cli.js": fileInfo("File", 0o644),
          }),
        ),
      ),
    );
    expect(result).toEqual({ available: true });
  });
});
