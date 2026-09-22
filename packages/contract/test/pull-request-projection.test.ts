import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  projectSessionPullRequests,
  PullRequestRefSchema,
  type SessionPullRequestLink,
} from "../src/pull-request";

const link = (number: number, headBranch: string, baseBranch: string): SessionPullRequestLink => {
  const ref = { host: "github.com", owner: "pie", repository: "pie", number };
  return {
    ref,
    source: "agent",
    linkedAt: `2026-01-${String(number).padStart(2, "0")}`,
    excluded: false,
    stack: null,
    stackCheckedAt: null,
    snapshot: {
      ref,
      headBranch,
      baseBranch,
      title: `PR ${number}`,
      checkedAt: "2026-01-01",
      lifecycle: { type: "open", draft: false },
    },
  };
};
describe("association projection", () => {
  it("keeps branch-adjacent associations separate without a native stack", () => {
    const top = link(1, "Top", "Base");
    const bottom = link(2, "Base", "main");
    const projection = projectSessionPullRequests([top, bottom]);
    expect(projection.badge).toBe("pr");
    expect(projection.groups.every((group) => group.type === "single")).toBe(true);
    expect(projection.representative).toBe(top);
  });
  it("preserves unknown and excludes canceled links", () => {
    const unknown = { ...link(1, "a", "main"), snapshot: null };
    expect(
      projectSessionPullRequests([unknown, { ...link(2, "b", "main"), excluded: true }]),
    ).toMatchObject({ count: 1, lifecycle: null, representative: unknown });
  });
  it("prefers native order", () => {
    const a = link(1, "a", "main"),
      b = link(2, "b", "main");
    const stack = {
      id: "S",
      number: 4,
      baseBranch: "main",
      layers: [b, a].map((item) => {
        const snapshot = item.snapshot;
        if (!snapshot) throw new Error("missing snapshot");
        return { ref: item.ref, headBranch: snapshot.headBranch, lifecycle: snapshot.lifecycle };
      }),
    };
    const projection = projectSessionPullRequests([{ ...a, stack }, b]);
    expect(projection.badge).toBe("stack");
    expect(projection.groups[0]?.links.map((item) => item.ref.number)).toEqual([2, 1]);
    expect(projection.representative?.ref.number).toBe(1);
  });
  it("rejects unsafe remote identities", () => {
    const decode = Schema.decodeUnknownSync(PullRequestRefSchema);
    for (const invalid of [
      { ...link(1, "a", "b").ref, number: 0 },
      { ...link(1, "a", "b").ref, host: "evil/path" },
      { ...link(1, "a", "b").ref, owner: "--exec" },
    ])
      expect(() => decode(invalid)).toThrow(/Expected|check/);
  });
});
