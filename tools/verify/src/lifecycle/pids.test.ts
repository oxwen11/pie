import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { CLI, WEB } from "../identity.ts";
import { writeJson } from "../runtime/fs.ts";
import { writePidFile } from "../runtime/process.ts";
import { recordedPids } from "./pids.ts";

describe("recordedPids", () => {
  it("reads the identity pid files", () => {
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "pie-verify-pids-"));
    fs.mkdirSync(path.join(runDir, "pids"));
    writePidFile(path.join(runDir, "pids/server.pid"), 111);
    writePidFile(path.join(runDir, "pids/vite.pid"), 222);
    expect(recordedPids(WEB, runDir)).toEqual([111, 222]);
  });

  it("includes the daemon record when the surface uses a daemon dir", () => {
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "pie-verify-pids-"));
    fs.mkdirSync(path.join(runDir, "pids"));
    fs.mkdirSync(path.join(runDir, "pie-home/daemon"), { recursive: true });
    writePidFile(path.join(runDir, "pids/serve.pid"), 333);
    writeJson(path.join(runDir, "pie-home/daemon/daemon.pid"), {
      pid: 444,
      address: "http://127.0.0.1:4182",
      token: "secret",
    });
    expect(recordedPids(CLI, runDir)).toEqual([333, 444]);
  });
});
