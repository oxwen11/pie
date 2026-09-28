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
});
