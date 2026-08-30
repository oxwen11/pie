import { describe, expect, it } from "vitest";

import { bearerToken, tokensMatch } from "../../src/http/auth";

describe("bearerToken", () => {
  it("extracts the token from a Bearer header", () => {
    expect(bearerToken("Bearer abc123")).toBe("abc123");
  });

  it("is case-insensitive on the scheme", () => {
    expect(bearerToken("bearer abc123")).toBe("abc123");
  });

  it("returns null for a missing header", () => {
    expect(bearerToken(undefined)).toBeNull();
  });

  it("returns null for a non-Bearer scheme", () => {
    expect(bearerToken("Basic abc123")).toBeNull();
  });

  it("returns null when the scheme has no value", () => {
    expect(bearerToken("Bearer")).toBeNull();
  });
});

describe("tokensMatch", () => {
  it("accepts an exact match", () => {
    expect(tokensMatch("s3cret", "s3cret")).toBe(true);
  });

  it("rejects a different token of the same length", () => {
    expect(tokensMatch("s3cret", "s3crey")).toBe(false);
  });

  it("rejects a different length", () => {
    expect(tokensMatch("s3cret", "s3cre")).toBe(false);
  });

  it("rejects null", () => {
    expect(tokensMatch("s3cret", null)).toBe(false);
  });
});
