import { describe, expect, it } from "vitest";

import { BROWSER_SESSION, DEFAULT_ROOT } from "./config.ts";

describe("DEFAULT_ROOT", () => {
  it("isolates under /tmp/pie-verify-web", () => {
    expect(DEFAULT_ROOT).toBe("/tmp/pie-verify-web");
  });
});

describe("BROWSER_SESSION", () => {
  it("uses a pie-verify session name", () => {
    expect(BROWSER_SESSION).toBe(process.env.VERIFY_PIE_BROWSER_SESSION ?? "pie-verify-web");
  });
});
