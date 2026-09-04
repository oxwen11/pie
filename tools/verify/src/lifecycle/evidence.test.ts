import { describe, expect, it } from "vitest";

import { evidenceNeedsBrowser } from "./evidence.ts";

describe("evidenceNeedsBrowser", () => {
  it("loads the run browser env for agent-browser backed web and desktop evidence", () => {
    for (const command of ["screenshot", "snapshot", "url"]) {
      expect(evidenceNeedsBrowser("web", command)).toBe(true);
      expect(evidenceNeedsBrowser("desktop", command)).toBe(true);
    }
  });

  it("skips the browser env for file-only evidence", () => {
    for (const command of ["path", "init", "note", "side-effects", "curl"]) {
      expect(evidenceNeedsBrowser("web", command)).toBe(false);
      expect(evidenceNeedsBrowser("desktop", command)).toBe(false);
    }
  });

  it("never touches a browser for the CLI surface", () => {
    for (const command of ["screenshot", "snapshot", "url", "curl", "note"]) {
      expect(evidenceNeedsBrowser("cli", command)).toBe(false);
    }
  });
});
