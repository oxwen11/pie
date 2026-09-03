import type { PullRequestListItem, PullRequestSnapshot } from "@getpie/contract/pull-request";
import { describe, expect, it } from "vitest";

import {
  actionConfirmationTitle,
  checksSummaryLabel,
  countDiffFiles,
  filterPullRequestItems,
  mergeMethodActionLabel,
  pullRequestActionInput,
  pullRequestSessionState,
  selectedPullRequest,
} from "./pull-request-presentation";

const snapshot: PullRequestSnapshot = {
  ref: { host: "github.com", owner: "getpie", repository: "pie", number: 42 },
  title: "Add pull request status",
  url: "https://github.com/getpie/pie/pull/42",
  head: { branch: "feature/pr-status", sha: "head-a" },
  baseBranch: "main",
  lifecycle: { type: "open", draft: false },
  mergeability: "mergeable",
  checks: { summary: "passing", items: [] },
  reviewDecision: "approved",
  autoMerge: null,
  offeredActions: [],
  updatedAt: "2026-08-30T00:00:00Z",
  body: "",
};

const listItem: PullRequestListItem = {
  ref: snapshot.ref,
  title: snapshot.title,
  url: snapshot.url,
  authorLogin: "getpie",
  headBranch: snapshot.head.branch,
  baseBranch: snapshot.baseBranch,
  lifecycle: snapshot.lifecycle,
  additions: 4,
  deletions: 1,
  updatedAt: snapshot.updatedAt,
};

describe("pull request presentation", () => {
  it("filters the viewer list by title, repo, branch, and number", () => {
    const other: PullRequestListItem = {
      ...listItem,
      ref: { ...listItem.ref, number: 7, repository: "server" },
      title: "Fix the daemon",
      url: "https://github.com/getpie/server/pull/7",
      headBranch: "fix/daemon",
    };
    expect(filterPullRequestItems([listItem, other], "  #42 ")).toEqual([listItem]);
    expect(filterPullRequestItems([listItem, other], "server")).toEqual([other]);
    expect(filterPullRequestItems([listItem, other], "feature/pr-status")).toEqual([listItem]);
  });

  it("keeps an explicit selection even when the search hides it", () => {
    const other: PullRequestListItem = {
      ...listItem,
      ref: { ...listItem.ref, number: 7 },
      title: "Fix the daemon",
      url: "https://github.com/getpie/pie/pull/7",
    };
    expect(selectedPullRequest([listItem, other], [other], listItem.ref)).toBe(listItem);
    expect(selectedPullRequest([listItem, other], [other], null)).toBe(other);
  });

  it("reduces snapshots to the lifecycle shown in a session row", () => {
    expect(pullRequestSessionState(snapshot)).toBe("open");
    expect(pullRequestSessionState({ ...snapshot, lifecycle: { type: "open", draft: true } })).toBe(
      "draft",
    );
    expect(pullRequestSessionState({ ...snapshot, lifecycle: { type: "closed" } })).toBe("closed");
    expect(pullRequestSessionState({ ...snapshot, lifecycle: { type: "merged" } })).toBe("merged");
    expect(pullRequestSessionState(null)).toBeUndefined();
  });

  it("freezes the expected pull request and head in a merge intent", () => {
    const ref = { projectId: crypto.randomUUID(), sessionId: "session-1" };
    const input = pullRequestActionInput(ref, snapshot, { type: "merge", method: "squash" });

    expect(input).toEqual({
      ref,
      expected: { pullRequest: snapshot.ref, headSha: "head-a" },
      action: { type: "merge", method: "squash" },
    });
    expect(
      pullRequestActionInput(snapshot.ref, snapshot, { type: "merge", method: "squash" }),
    ).toEqual({
      ref: snapshot.ref,
      expected: { pullRequest: snapshot.ref, headSha: "head-a" },
      action: { type: "merge", method: "squash" },
    });
  });

  it("labels checks, merge methods, and confirmation titles", () => {
    expect(checksSummaryLabel("passing")).toBe("Checks passing");
    expect(mergeMethodActionLabel("squash")).toBe("Squash and merge");
    expect(actionConfirmationTitle({ type: "disable-auto-merge" })).toBe("Disable auto-merge");
    expect(actionConfirmationTitle({ type: "enable-auto-merge", method: "rebase" })).toBe(
      "Enable auto-merge · Rebase",
    );
  });

  it("counts files in a git patch", () => {
    expect(countDiffFiles("")).toBe(0);
    expect(
      countDiffFiles(
        "diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\ndiff --git a/b.ts b/b.ts\n",
      ),
    ).toBe(2);
  });

  it("does not require a head commit to disable auto-merge", () => {
    const ref = { projectId: crypto.randomUUID(), sessionId: "session-1" };
    expect(pullRequestActionInput(ref, snapshot, { type: "disable-auto-merge" })).toEqual({
      ref,
      expected: { pullRequest: snapshot.ref },
      action: { type: "disable-auto-merge" },
    });
  });
});
