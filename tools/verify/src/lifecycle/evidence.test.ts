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
    for (const command of ["path", "init", "note", "side-effects", "pack-video"]) {
      expect(evidenceNeedsBrowser("web", command)).toBe(false);
      expect(evidenceNeedsBrowser("desktop", command)).toBe(false);
    }
  });

  it("loads the browser env for Desktop curl evidence, but not web or CLI curl", () => {
    expect(evidenceNeedsBrowser("desktop", "curl")).toBe(true);
    expect(evidenceNeedsBrowser("web", "curl")).toBe(false);
    expect(evidenceNeedsBrowser("cli", "curl")).toBe(false);
  });

  it("never touches a browser for the CLI surface", () => {
    for (const command of ["screenshot", "snapshot", "url", "curl", "note"]) {
      expect(evidenceNeedsBrowser("cli", command)).toBe(false);
    }
  });
});
