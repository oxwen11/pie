import { describe, expect, it } from "vitest";

import {
  decodeDaemonCompatibilityKey,
  embeddedDaemonCompatibilityKey,
  makeGitHashDaemonCompatibilityKey,
  makeProtocolDaemonCompatibilityKey,
} from "./compatibility";

describe("daemon compatibility key", () => {
  it("normalizes Git hashes to eight lowercase characters under the githash namespace", () => {
    expect(makeGitHashDaemonCompatibilityKey("D1FB90041E2F8213C4B05440EBDD6160E9909CB6")).toBe(
      "githash:d1fb9004",
    );
    expect(makeGitHashDaemonCompatibilityKey("d1fb9004")).toBe("githash:d1fb9004");
    expect(decodeDaemonCompatibilityKey("githash:d1fb9004")).toBe("githash:d1fb9004");
  });

  it("constructs and decodes protocol keys with a positive safe integer version", () => {
    expect(makeProtocolDaemonCompatibilityKey(1)).toBe("protocol:1");
    expect(decodeDaemonCompatibilityKey("protocol:42")).toBe("protocol:42");
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

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid protocol version %s",
    (version) => {
      expect(() => makeProtocolDaemonCompatibilityKey(version)).toThrow(/positive safe integer/);
      expect(decodeDaemonCompatibilityKey(`protocol:${version}`)).toBeUndefined();
    },
  );

  it.each([
    undefined,
    null,
    1,
    "release-123",
    "dev",
    "D1FB9004",
    "d1fb9004",
    "protocol:01",
    "protocol:+1",
    "protocol:1.0",
    "protocol:1e2",
    "protocol:9007199254740992",
  ])("rejects malformed persisted value %j", (value) => {
    expect(decodeDaemonCompatibilityKey(value)).toBeUndefined();
  });
});
