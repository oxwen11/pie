import { describe, expect, it } from "vitest";

import {
  decodeDaemonCompatibilityKey,
  embeddedDaemonCompatibilityKey,
  makeGitHashDaemonCompatibilityKey,
} from "./compatibility";

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
    expect(() => embeddedDaemonCompatibilityKey(undefined)).toThrow(/PIE_DAEMON_COMPATIBILITY_KEY/);
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
