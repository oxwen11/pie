import type { SessionRef } from "@getpie/contract";
import type { PullRequestRef, PullRequestSnapshot } from "@getpie/contract/pull-request";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { foldSessionStatuses } from "../src/pull-request/statuses";

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
  body: "",
});

const ref = (sessionId: string): SessionRef => ({ projectId: "project", sessionId });

const pullRequest = (number: number): PullRequestRef => ({
  host: "github.com",
  owner: "getpie",
  repository: "pie",
  number,
});

describe("foldSessionStatuses", () => {
  it("looks up a shared cwd once when no refs are stored", async () => {
    const lookups: Array<{ cwd: string; number: number | undefined }> = [];
    const first = ref("s1");
    const second = ref("s2");
    const result = await Effect.runPromise(
      foldSessionStatuses(
        [
          { ref: first, cwd: "/ws", pullRequestRefs: [] },
          { ref: second, cwd: "/ws", pullRequestRefs: [] },
        ],
        (cwd, stored) => {
          lookups.push({ cwd, number: stored?.number });
          return Effect.succeed(snapshot({ type: "merged" }));
        },
      ),
    );
    expect(lookups).toEqual([{ cwd: "/ws", number: undefined }]);
    expect(result).toEqual([
      { ref: first, lifecycle: { type: "merged" }, url: snapshot({ type: "merged" }).url },
      { ref: second, lifecycle: { type: "merged" }, url: snapshot({ type: "merged" }).url },
    ]);
  });

  it("looks up a shared stored pull request once", async () => {
    const lookups: Array<{ cwd: string; number: number | undefined }> = [];
    const stored = pullRequest(42);
    const first = ref("s1");
    const second = ref("s2");
    const open = snapshot({ type: "open", draft: false }, 42);
    const result = await Effect.runPromise(
      foldSessionStatuses(
        [
          { ref: first, cwd: "/a", pullRequestRefs: [stored] },
          { ref: second, cwd: "/b", pullRequestRefs: [stored] },
        ],
        (cwd, candidate) => {
          lookups.push({ cwd, number: candidate?.number });
          return Effect.succeed(open);
        },
      ),
    );
    expect(lookups).toEqual([{ cwd: "/a", number: 42 }]);
    expect(result).toEqual([
      { ref: first, lifecycle: open.lifecycle, url: open.url },
      { ref: second, lifecycle: open.lifecycle, url: open.url },
    ]);
  });
});
