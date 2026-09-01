import type { PullRequestSnapshot } from "@getpie/contract/pull-request";
import { describe, expect, it } from "vitest";

import {
  pullRequestActionInput,
  pullRequestHeaderStatus,
  pullRequestSessionState,
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
};

describe("pull request presentation", () => {
  it("prioritizes lifecycle and conflict states over check summaries", () => {
    expect(pullRequestHeaderStatus(snapshot)).toEqual({
      label: "Checks passing",
      tone: "positive",
    });
    expect(pullRequestHeaderStatus({ ...snapshot, mergeability: "conflicting" })).toEqual({
      label: "Conflicts",
      tone: "negative",
    });
    expect(pullRequestHeaderStatus({ ...snapshot, lifecycle: { type: "merged" } })).toEqual({
      label: "Merged",
      tone: "accent",
    });
    expect(pullRequestHeaderStatus(null)).toBeUndefined();
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
