import { describe, expect, it } from "vitest";

import { batchToolParts } from "./use-tool-batches";

describe("batchToolParts", () => {
  it("emits reasoning-only runs as passthrough items", () => {
    const items = batchToolParts([
      { type: "reasoning", text: "hm", state: "done" },
      { type: "text", text: "hello", state: "done" },
    ]);

    expect(items).toEqual([
      { kind: "passthrough", part: { type: "reasoning", text: "hm", state: "done" }, index: 0 },
      { kind: "passthrough", part: { type: "text", text: "hello", state: "done" }, index: 1 },
    ]);
  });

  it("keeps reasoning inside a tool batch when tools are present", () => {
    const items = batchToolParts([
      { type: "reasoning", text: "plan", state: "done" },
      {
        type: "tool-read",
        toolCallId: "t1",
        state: "output-available",
        input: { path: "/tmp/a" },
        output: "ok",
      },
      { type: "text", text: "done", state: "done" },
    ]);

    expect(items[0]).toMatchObject({
      kind: "tool-batch",
      isTrailing: false,
      parts: [
        { part: { type: "reasoning", text: "plan", state: "done" }, index: 0 },
        { part: { type: "tool-read", toolCallId: "t1" }, index: 1 },
      ],
    });
    expect(items[1]).toMatchObject({
      kind: "passthrough",
      part: { type: "text", text: "done", state: "done" },
      index: 2,
    });
  });
});
