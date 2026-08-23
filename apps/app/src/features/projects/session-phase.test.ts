import { describe, expect, it } from "vitest";

import { formatSessionPhaseLabel, sessionPhaseBadgeVariant } from "./session-phase";

describe("formatSessionPhaseLabel", () => {
  it("returns labels only for non-idle phases", () => {
    expect(formatSessionPhaseLabel("idle")).toBeUndefined();
    expect(formatSessionPhaseLabel("running")).toBe("Running");
    expect(formatSessionPhaseLabel("requires_action")).toBe("Action needed");
    expect(formatSessionPhaseLabel("crashed")).toBe("Error");
  });
});

describe("sessionPhaseBadgeVariant", () => {
  it("maps phases to badge variants", () => {
    expect(sessionPhaseBadgeVariant("idle")).toBeUndefined();
    expect(sessionPhaseBadgeVariant("running")).toBe("success");
    expect(sessionPhaseBadgeVariant("requires_action")).toBe("warning");
    expect(sessionPhaseBadgeVariant("crashed")).toBe("error");
  });
});
