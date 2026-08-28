import { describe, expect, it } from "vitest";

import { thinkingTriggerLabel } from "./reasoning.logic";

describe("thinkingTriggerLabel", () => {
  it("shows Thinking only while the block is streaming", () => {
    expect(thinkingTriggerLabel(true, undefined)).toBe("Thinking...");
    expect(thinkingTriggerLabel(true, 0)).toBe("Thinking...");
    expect(thinkingTriggerLabel(true, 4)).toBe("Thinking...");
  });

  it("does not keep Thinking after the block ends without a measured duration", () => {
    expect(thinkingTriggerLabel(false, undefined)).toBe("Thought for a few seconds");
    expect(thinkingTriggerLabel(false, 0)).toBe("Thought for a few seconds");
  });

  it("reports a measured duration once streaming has ended", () => {
    expect(thinkingTriggerLabel(false, 1)).toBe("Thought for 1 second");
    expect(thinkingTriggerLabel(false, 3)).toBe("Thought for 3 seconds");
  });
});
