import { describe, expect, it } from "vitest";

import { catalogPageRange } from "./package-model";

describe("catalogPageRange", () => {
  it("returns an empty range when nothing matched", () => {
    expect(catalogPageRange(1, 50, 0)).toEqual({ pageCount: 1, pageEnd: 0, pageStart: 0 });
  });
});
