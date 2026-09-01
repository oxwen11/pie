import { describe, expect, it } from "vitest";

import { runCliSurface } from "./cli.ts";

describe("runCliSurface", () => {
  it("refuses agent-browser — CLI proofs have no page", async () => {
    await expect(runCliSurface(["browser", "snapshot"])).rejects.toThrow(/no browser/);
  });
});
