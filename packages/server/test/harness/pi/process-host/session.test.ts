import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { openSessionManager } from "../../../../src/harness/pi/process-host/session";

describe("openSessionManager", () => {
  it("creates a manager with the requested id when none exists", async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pie-pi-session-"));
    const sessionDir = path.join(cwd, "sessions");
    const created = await openSessionManager({ cwd, sessionId: "sess-1", sessionDir });
    expect(created.getSessionId()).toBe("sess-1");
  });

  it("opens an existing session file with that id", async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pie-pi-session-"));
    const sessionDir = path.join(cwd, "sessions");
    fs.mkdirSync(sessionDir);
    const file = path.join(sessionDir, "t_sess-1.jsonl");
    fs.writeFileSync(
      file,
      `${JSON.stringify({
        type: "session",
        version: 3,
        id: "sess-1",
        timestamp: "2026-08-27T00:00:00.000Z",
        cwd,
      })}\n`,
    );
    const opened = await openSessionManager({ cwd, sessionId: "sess-1", sessionDir });
    expect(opened.getSessionId()).toBe("sess-1");
    expect(opened.getSessionFile()).toBe(path.resolve(file));
  });
});
