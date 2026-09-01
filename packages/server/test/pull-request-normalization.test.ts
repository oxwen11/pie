import { describe, expect, it } from "vitest";

import {
  InvalidPullRequestJsonError,
  normalizeGitHubPullRequestJson,
} from "../src/pull-request/normalization";

const openFixture = {
  // Captured from github.com with gh 2.97.0 on 2026-08-30, then sanitized.
  autoMergeRequest: null,
  baseRefName: "main",
  headRefName: "feature/pr-status",
  headRefOid: "1111111111111111111111111111111111111111",
  isDraft: false,
  mergeable: "MERGEABLE",
  number: 42,
  reviewDecision: "APPROVED",
  state: "OPEN",
  statusCheckRollup: [
    {
      __typename: "CheckRun",
      conclusion: "FAILURE",
      detailsUrl: "https://github.com/getpie/pie/actions/runs/1",
      name: "Check",
      status: "COMPLETED",
      workflowName: "Code check",
    },
    {
      __typename: "StatusContext",
      context: "Preview",
      state: "SUCCESS",
      targetUrl: "https://example.com/preview",
    },
  ],
  title: "Add pull request status",
  updatedAt: "2026-08-30T00:00:00Z",
  url: "https://github.com/getpie/pie/pull/42",
};

describe("normalizeGitHubPullRequestJson", () => {
  it("normalizes identity, lifecycle, checks, reviews, and offered actions", () => {
    const snapshot = normalizeGitHubPullRequestJson(openFixture);

    expect(snapshot.ref).toEqual({
      host: "github.com",
      owner: "getpie",
      repository: "pie",
      number: 42,
    });
    expect(snapshot.lifecycle).toEqual({ type: "open", draft: false });
    expect(snapshot.checks.summary).toBe("failing");
    expect(snapshot.checks.items.map((check) => check.status)).toEqual(["failure", "success"]);
    expect(snapshot.reviewDecision).toBe("approved");
    expect(snapshot.offeredActions.map((action) => action.type)).toEqual([
      "merge",
      "enable-auto-merge",
    ]);
  });

  it("maps draft, auto-merge, and terminal lifecycle shapes without invalid action combinations", () => {
    const draft = normalizeGitHubPullRequestJson({ ...openFixture, isDraft: true });
    const autoMerge = normalizeGitHubPullRequestJson({
      ...openFixture,
      autoMergeRequest: { mergeMethod: "SQUASH" },
    });
    const merged = normalizeGitHubPullRequestJson({
      ...openFixture,
      isDraft: false,
      state: "MERGED",
    });

    expect(draft.lifecycle).toEqual({ type: "open", draft: true });
    expect(draft.offeredActions).toEqual([]);
    expect(autoMerge.autoMerge).toEqual({ method: "squash" });
    expect(autoMerge.offeredActions).toEqual([{ type: "disable-auto-merge" }]);
    expect(merged.lifecycle).toEqual({ type: "merged" });
    expect(merged.offeredActions).toEqual([]);
  });

  it("does not call an empty or neutral-only check rollup passing", () => {
    const empty = normalizeGitHubPullRequestJson({
      ...openFixture,
      statusCheckRollup: [],
    });
    const neutral = normalizeGitHubPullRequestJson({
      ...openFixture,
      statusCheckRollup: [
        {
          __typename: "CheckRun",
          conclusion: "NEUTRAL",
          detailsUrl: null,
          name: "Optional",
          status: "COMPLETED",
          workflowName: "",
        },
      ],
    });

    expect(empty.checks.summary).toBe("none");
    expect(neutral.checks.summary).toBe("none");
  });

  it("rejects malformed identity instead of guessing", () => {
    expect(() =>
      normalizeGitHubPullRequestJson({
        ...openFixture,
        url: "https://github.com/getpie/pie/pull/99",
      }),
    ).toThrow(InvalidPullRequestJsonError);
  });
});
