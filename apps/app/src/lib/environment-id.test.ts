import { describe, expect, it } from "vitest";

import { parseEnvironmentId } from "./environment-id";

describe("parseEnvironmentId", () => {
  it("reads a non-empty id", () => {
    expect(parseEnvironmentId({ id: "env-1" })).toBe("env-1");
  });

  it("rejects missing or empty ids", () => {
    expect(parseEnvironmentId(null)).toBeUndefined();
    expect(parseEnvironmentId({})).toBeUndefined();
    expect(parseEnvironmentId({ id: "" })).toBeUndefined();
    expect(parseEnvironmentId({ id: 1 })).toBeUndefined();
  });
});
