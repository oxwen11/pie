import { describe, expect, it } from "vitest";

import { reviewHeading } from "./review-file-status";

describe("reviewHeading", () => {
  it("names a feature-branch review against its base", () => {
    expect(reviewHeading("feature/auth", "main")).toBe("feature/auth → main");
  });

  it("names uncommitted work on the default branch", () => {
    expect(reviewHeading("main", null)).toBe("Uncommitted changes on main");
  });

  it("falls back when the branch name is missing", () => {
    expect(reviewHeading(null, null)).toBe("Uncommitted changes");
  });
});
