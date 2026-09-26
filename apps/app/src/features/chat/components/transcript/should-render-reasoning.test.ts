import { describe, expect, it } from "vitest";

import { shouldRenderReasoningPart } from "./should-render-reasoning";

describe("shouldRenderReasoningPart", () => {
  it("keeps an empty reasoning block visible while the message is streaming", () => {
    expect(shouldRenderReasoningPart({ type: "reasoning", text: "" }, true)).toBe(true);
  });
});
