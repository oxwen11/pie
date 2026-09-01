import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { PullRequestSnapshot } from "@getpie/contract/pull-request";
import { Effect, Layer } from "effect";
import { simpleGit } from "simple-git";
import { describe, expect, it } from "vitest";

import { PullRequestService } from "../src/pull-request";
import { makeRpcTestHarness } from "./rpc-harness";

async function makeRepository(): Promise<string> {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pie-pr-repository-"));
  fs.writeFileSync(path.join(cwd, "README.md"), "# acceptance\n");
  const git = simpleGit(cwd);
  await git.raw(["init", "-b", "main"]);
  await git.addConfig("user.email", "test@example.com");
  await git.addConfig("user.name", "Test");
  await git.add(".");
  await git.commit("initial");
  return cwd;
}

const snapshot: PullRequestSnapshot = {
  ref: { host: "github.com", owner: "getpie", repository: "pie", number: 42 },
  title: "Add pull request status",
  url: "https://github.com/getpie/pie/pull/42",
  head: { branch: "feature/pr-status", sha: "expected-sha" },
  baseBranch: "main",
  lifecycle: { type: "open", draft: false },
  mergeability: "mergeable",
  checks: { summary: "none", items: [] },
  reviewDecision: "none",
  autoMerge: null,
  offeredActions: [],
  updatedAt: "2026-08-30T00:00:00Z",
};

const quietPullRequestLayer = Layer.succeed(PullRequestService, {
  current: () => Effect.succeed(null),
  runAction: () => Effect.die("unexpected pull request action"),
});

describe("pull request router", () => {
  it("resolves SessionRef to the persisted worktree and returns action acknowledgement", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "pie-pr-home-"));
    const workspace = await makeRepository();
    let receivedCwd: string | undefined;
    const pullRequestLayer = Layer.succeed(PullRequestService, {
      current: (cwd) => {
        receivedCwd = cwd;
        return Effect.succeed(snapshot);
      },
      runAction: (cwd, _expected, action) => {
        receivedCwd = cwd;
        return Effect.succeed({
          pullRequest: snapshot.ref,
          action: action.type,
          ...(action.type === "disable-auto-merge"
            ? undefined
            : { appliedHeadSha: snapshot.head.sha }),
        });
      },
    });
    const harness = await makeRpcTestHarness(home, { pullRequestLayer });
    try {
      const project = await harness.client.project.create({ path: workspace });
      const created = await harness.client.agent.session.create({
        projectId: project.id,
        worktree: {},
      });

      await expect(harness.client.pullRequest.current({ ref: created.ref })).resolves.toEqual(
        snapshot,
      );
      expect(created.workspace.cwd).not.toBe(workspace);
      expect(receivedCwd).toBe(created.workspace.cwd);

      await expect(
        harness.client.pullRequest.runAction({
          ref: created.ref,
          expected: { pullRequest: snapshot.ref, headSha: snapshot.head.sha },
          action: { type: "merge", method: "squash" },
        }),
      ).resolves.toEqual({
        pullRequest: snapshot.ref,
        action: "merge",
        appliedHeadSha: snapshot.head.sha,
      });
      expect(receivedCwd).toBe(created.workspace.cwd);
    } finally {
      await harness.dispose();
    }
  });

  it("batches session-list statuses by persisted cwd", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "pie-pr-home-"));
    const workspace = await makeRepository();
    const receivedCwds: Array<string> = [];
    const pullRequestLayer = Layer.succeed(PullRequestService, {
      current: (cwd) => {
        receivedCwds.push(cwd);
        return Effect.succeed({ ...snapshot, lifecycle: { type: "merged" } as const });
      },
      runAction: () => Effect.die("unexpected pull request action"),
    });
    const harness = await makeRpcTestHarness(home, { pullRequestLayer });
    try {
      const project = await harness.client.project.create({ path: workspace });
      const first = await harness.client.agent.session.create({ projectId: project.id });
      const second = await harness.client.agent.session.create({ projectId: project.id });

      await expect(
        harness.client.pullRequest.statuses({ refs: [first.ref, second.ref] }),
      ).resolves.toEqual([
        { ref: first.ref, lifecycle: { type: "merged" } },
        { ref: second.ref, lifecycle: { type: "merged" } },
      ]);
      expect(receivedCwds).toEqual([workspace]);
    } finally {
      await harness.dispose();
    }
  });

  it("maps a missing SessionRef before calling the pull request service", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "pie-pr-home-"));
    const harness = await makeRpcTestHarness(home, { pullRequestLayer: quietPullRequestLayer });
    try {
      await expect(
        harness.client.pullRequest.current({
          ref: { projectId: crypto.randomUUID(), sessionId: crypto.randomUUID() },
        }),
      ).rejects.toMatchObject({ code: "SESSION_NOT_FOUND" });
    } finally {
      await harness.dispose();
    }
  });
});
