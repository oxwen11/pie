import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { redactDaemonRecord } from "./daemon.ts";
import { readJson, writeJson } from "./fs.ts";

describe("redactDaemonRecord", () => {
  it("copies the record with the token stripped", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "verify-pie-cli-"));
    const src = path.join(dir, "daemon.pid");
    const dest = path.join(dir, "daemon.pid.redacted.json");
    writeJson(src, {
      pid: 12,
      address: "http://127.0.0.1:4182",
      token: "secret-token",
      compatibilityKey: "githash:d1fb9004",
    });

    redactDaemonRecord(src, dest);

    expect(readJson<Record<string, unknown>>(dest)).toEqual({
      pid: 12,
      address: "http://127.0.0.1:4182",
      token: "[redacted]",
      compatibilityKey: "githash:d1fb9004",
    });
    expect(readJson<Record<string, unknown>>(src).token).toBe("secret-token");
  });
});
