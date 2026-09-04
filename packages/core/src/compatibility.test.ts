import childProcess from "node:child_process";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  DAEMON_COMPATIBILITY_KEY_ENV,
  daemonCompatibilityKeyForBuild,
  decodeDaemonCompatibilityKey,
  embeddedDaemonCompatibilityKey,
  makeGitHashDaemonCompatibilityKey,
  resolveDaemonCompatibilityKey,
} from "./compatibility";

const packageRoot = path.join(import.meta.dirname, "..");
const repoRoot = path.join(packageRoot, "..", "..");
const printScript = path.join(packageRoot, "print-daemon-compatibility-key.ts");

describe("daemon compatibility key", () => {
  it("normalizes Git hashes to eight lowercase characters under the githash namespace", () => {
    expect(makeGitHashDaemonCompatibilityKey("D1FB90041E2F8213C4B05440EBDD6160E9909CB6")).toBe(
      "githash:d1fb9004",
    );
    expect(makeGitHashDaemonCompatibilityKey("d1fb9004")).toBe("githash:d1fb9004");
    expect(decodeDaemonCompatibilityKey("githash:d1fb9004")).toBe("githash:d1fb9004");
  });

  it("requires a statically embedded valid key", () => {
    expect(embeddedDaemonCompatibilityKey("githash:d1fb9004")).toBe("githash:d1fb9004");
    expect(() => embeddedDaemonCompatibilityKey(undefined)).toThrow(
      new RegExp(DAEMON_COMPATIBILITY_KEY_ENV),
    );
  });

  describe("daemonCompatibilityKeyForBuild", () => {
    const previous = process.env[DAEMON_COMPATIBILITY_KEY_ENV];

    afterEach(() => {
      if (previous === undefined) delete process.env[DAEMON_COMPATIBILITY_KEY_ENV];
      else process.env[DAEMON_COMPATIBILITY_KEY_ENV] = previous;
    });

    it("embeds a valid env value so Turbo's hash matches the artifact", () => {
      process.env[DAEMON_COMPATIBILITY_KEY_ENV] = "githash:abcd1234";
      expect(daemonCompatibilityKeyForBuild({ cwd: repoRoot })).toBe("githash:abcd1234");
    });

    it("resolves from Git when the env value is missing or malformed", () => {
      delete process.env[DAEMON_COMPATIBILITY_KEY_ENV];
      const resolved = resolveDaemonCompatibilityKey({ cwd: repoRoot });
      expect(daemonCompatibilityKeyForBuild({ cwd: repoRoot })).toBe(resolved);

      process.env[DAEMON_COMPATIBILITY_KEY_ENV] = "not-a-key";
      expect(daemonCompatibilityKeyForBuild({ cwd: repoRoot })).toBe(resolved);
    });
  });

  it("print-daemon-compatibility-key writes the Git-resolved key", () => {
    const printed = childProcess
      .execFileSync(process.execPath, [printScript], {
        cwd: repoRoot,
        encoding: "utf8",
        env: { ...process.env, [DAEMON_COMPATIBILITY_KEY_ENV]: "" },
      })
      .trim();
    expect(printed).toBe(resolveDaemonCompatibilityKey({ cwd: repoRoot }));
  });

  it.each(["", "d1fb900", "d1fb900g", "d1fb90041e2f8213c4b05440ebdd6160e9909cb60"])(
    "rejects invalid Git hash %j",
    (gitHash) => {
      expect(() => makeGitHashDaemonCompatibilityKey(gitHash)).toThrow(/8 to 40 hexadecimal/);
      expect(decodeDaemonCompatibilityKey(gitHash)).toBeUndefined();
    },
  );

  it.each([undefined, null, 1, "release-123", "dev", "D1FB9004", "d1fb9004", "protocol:1"])(
    "rejects malformed persisted value %j",
    (value) => {
      expect(decodeDaemonCompatibilityKey(value)).toBeUndefined();
    },
  );
});
