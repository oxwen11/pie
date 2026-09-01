import type { PullRequestSnapshot } from "@getpie/contract/pull-request";
import { describe, expect, it } from "vitest";

import { pickSessionPullRequestLifecycle } from "../src/pull-request/pick-lifecycle";

const snapshot = (
  lifecycle: PullRequestSnapshot["lifecycle"],
  number = 1,
): PullRequestSnapshot => ({
  ref: { host: "github.com", owner: "getpie", repository: "pie", number },
  title: "status",
  url: `https://github.com/getpie/pie/pull/${number}`,
  head: { branch: "feature", sha: "sha" },
  baseBranch: "main",
  lifecycle,
  mergeability: "mergeable",
  checks: { summary: "none", items: [] },
  reviewDecision: "none",
  autoMerge: null,
  offeredActions: [],
  updatedAt: "2026-08-30T00:00:00Z",
});

describe("pickSessionPullRequestLifecycle", () => {
  it("returns undefined when nothing resolved", () => {
    expect(pickSessionPullRequestLifecycle([])).toBeUndefined();
    expect(pickSessionPullRequestLifecycle([null, null])).toBeUndefined();
  });

  it("prefers the last still-open snapshot", () => {
    expect(
      pickSessionPullRequestLifecycle([
        snapshot({ type: "open", draft: false }, 1),
        snapshot({ type: "merged" }, 2),
        snapshot({ type: "open", draft: true }, 3),
      ]),
    ).toEqual({ type: "open", draft: true });
  });

  it("falls back to the last resolved snapshot when none are open", () => {
    expect(
      pickSessionPullRequestLifecycle([
        snapshot({ type: "closed" }, 1),
        null,
        snapshot({ type: "merged" }, 2),
      ]),
    ).toEqual({ type: "merged" });
  });
});
