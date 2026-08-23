import { describe, expect, it } from "vitest";

import { sessionStatusIndicator } from "./session-status-indicator";

describe("sessionStatusIndicator", () => {
  it("shows a pulsing green dot while running", () => {
    expect(sessionStatusIndicator("running")).toEqual({
      className: "ms-auto size-2 shrink-0 animate-pulse rounded-full bg-emerald-500",
      title: "A turn is running in this session",
    });
  });

  it("shows an amber dot while waiting for user action", () => {
    expect(sessionStatusIndicator("requires_action")).toEqual({
      className: "ms-auto size-2 shrink-0 rounded-full bg-warning",
      title: "Waiting for your action",
    });
  });

  it("shows a red dot when the session crashed", () => {
    expect(sessionStatusIndicator("crashed")).toEqual({
      className: "ms-auto size-2 shrink-0 rounded-full bg-destructive",
      title: "Session crashed",
    });
  });

  it("shows nothing for idle or missing status", () => {
    expect(sessionStatusIndicator("idle")).toBeNull();
    expect(sessionStatusIndicator(undefined)).toBeNull();
  });
});
