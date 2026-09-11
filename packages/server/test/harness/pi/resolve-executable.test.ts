import path from "node:path";
import url from "node:url";

import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import {
  checkPiAvailability,
  parsePiRuntime,
  piAvailabilityTarget,
  resolveAsarUnpackedPath,
  resolveBundledPiCli,
  resolvePiExecutable,
} from "../../../src/harness/pi/resolve-executable";
import { fakeExecutables, fakeStats, fileInfo } from "../../fake-file-system";

describe("resolveAsarUnpackedPath", () => {
  it("rewrites the asar directory to the unpacked sibling", () => {
    expect(
      resolveAsarUnpackedPath(
        "/Applications/Pie.app/Contents/Resources/app.asar/node_modules/@earendil-works/pi-coding-agent/dist/cli.js",
      ),
    ).toBe(
      "/Applications/Pie.app/Contents/Resources/app.asar.unpacked/node_modules/@earendil-works/pi-coding-agent/dist/cli.js",
    );
  });

  it("leaves an already-unpacked path unchanged", () => {
    const unpacked =
      "/Applications/Pie.app/Contents/Resources/app.asar.unpacked/node_modules/@earendil-works/pi-coding-agent/dist/cli.js";
    expect(resolveAsarUnpackedPath(unpacked)).toBe(unpacked);
  });

  it("leaves a non-asar path unchanged", () => {
    expect(resolveAsarUnpackedPath("/opt/pi/dist/cli.js")).toBe("/opt/pi/dist/cli.js");
  });
});

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

  it("falls back to bundled pi-coding-agent via Node", () => {
    const bundled = resolveBundledPiCli();
    expect(bundled).toBeTruthy();
    expect(resolvePiExecutable({})).toEqual({
      command: process.execPath,
      prefixArgs: [bundled!],
    });
  });

  it("keeps the Node spawn path when PIE_PI_RUNTIME is node", () => {
    const bundled = resolveBundledPiCli();
    expect(resolvePiExecutable({ PIE_PI_RUNTIME: "node" })).toEqual({
      command: process.execPath,
      prefixArgs: [bundled!],
    });
  });

  it("spawns bun plus bundled cli.js when PIE_PI_RUNTIME=bun", () => {
    const bundled = resolveBundledPiCli();
    expect(bundled).toBeTruthy();
    expect(resolvePiExecutable({ PIE_PI_RUNTIME: "bun" })).toEqual({
      command: "bun",
      prefixArgs: [bundled!],
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

  it("rewrites a bundled asar cli.js so bun opens the unpacked file", () => {
    expect(
      resolvePiExecutable(
        { PIE_PI_RUNTIME: "bun" },
        {
          resolveBundledCli: () =>
            "/Applications/Pie.app/Contents/Resources/app.asar/node_modules/@earendil-works/pi-coding-agent/dist/cli.js",
        },
      ),
    ).toEqual({
      command: "bun",
      prefixArgs: [
        "/Applications/Pie.app/Contents/Resources/app.asar.unpacked/node_modules/@earendil-works/pi-coding-agent/dist/cli.js",
      ],
    });
  });

  it("rewrites an asar PIE_PI_EXECUTABLE under bun", () => {
    expect(
      resolvePiExecutable({
        PIE_PI_RUNTIME: "bun",
        PIE_PI_EXECUTABLE:
          "/Applications/Pie.app/Contents/Resources/app.asar/node_modules/@earendil-works/pi-coding-agent/dist/cli.js",
      }),
    ).toEqual({
      command: "bun",
      prefixArgs: [
        "/Applications/Pie.app/Contents/Resources/app.asar.unpacked/node_modules/@earendil-works/pi-coding-agent/dist/cli.js",
      ],
    });
  });

  it("does not rewrite asar paths on the Electron Node spawn path", () => {
    const asarCli =
      "/Applications/Pie.app/Contents/Resources/app.asar/node_modules/@earendil-works/pi-coding-agent/dist/cli.js";
    expect(resolvePiExecutable({}, { resolveBundledCli: () => asarCli })).toEqual({
      command: process.execPath,
      prefixArgs: [asarCli],
    });
  });

  it("does not run a shebang PIE_PI_EXECUTABLE under bun", () => {
    const bundled = resolveBundledPiCli();
    expect(
      resolvePiExecutable({
        PIE_PI_RUNTIME: "bun",
        PIE_PI_EXECUTABLE: "/usr/bin/pi",
      }),
    ).toEqual({ command: "bun", prefixArgs: [bundled!] });
  });

  it("returns bun with no script when cli.js cannot be resolved", () => {
    expect(
      resolvePiExecutable({ PIE_PI_RUNTIME: "bun" }, { resolveBundledCli: () => undefined }),
    ).toEqual({ command: "bun", prefixArgs: [] });
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
        "Pi cli.js was not found. PIE_PI_RUNTIME=bun needs the script entry, not the shebang binary.",
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
