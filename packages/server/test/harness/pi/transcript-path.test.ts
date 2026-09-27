import assert from "node:assert/strict";
import path from "node:path";

import { describe, it } from "vitest";

import { piSessionDir, transcriptPathIn } from "../../../src/harness/pi/transcript-path";

describe("transcript path", () => {
  it("encodes the cwd the way Pi's default session dir does", () => {
    assert.equal(path.basename(piSessionDir("/tmp/pie")), "--tmp-pie--");
  });

  it("returns the jsonl named for the agent session id", () => {
    assert.equal(
      transcriptPathIn("/sessions", "agent-1", ["other.jsonl", "2026_agent-1.jsonl"]),
      path.join("/sessions", "2026_agent-1.jsonl"),
    );
    assert.equal(transcriptPathIn("/sessions", "missing", ["2026_agent-1.jsonl"]), undefined);
    assert.equal(transcriptPathIn("/sessions", "agent-1", ["../2026_agent-1.jsonl"]), undefined);
  });
});
