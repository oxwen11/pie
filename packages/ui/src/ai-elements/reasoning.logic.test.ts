import { describe, expect, it } from "vitest";

import { thinkingTriggerLabel } from "./reasoning.logic";

describe("thinkingTriggerLabel", () => {
  it("shows Thinking only while the block is streaming", () => {
    expect(thinkingTriggerLabel(true, undefined)).toBe("Thinking...");
    expect(thinkingTriggerLabel(true, 4)).toBe("Thinking...");
  });

  it("shows Thought after the block ends when no duration is known", () => {
    expect(thinkingTriggerLabel(false, undefined)).toBe("Thought");
    expect(thinkingTriggerLabel(false, 0)).toBe("Thought");
  });

  it("reports a caller-supplied duration once streaming has ended", () => {
    expect(thinkingTriggerLabel(false, 1)).toBe("Thought for 1 second");
    expect(thinkingTriggerLabel(false, 3)).toBe("Thought for 3 seconds");
  });
});
