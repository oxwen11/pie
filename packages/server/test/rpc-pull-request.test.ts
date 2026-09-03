import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { PullRequestSnapshot } from "@getpie/contract/pull-request";
import { Effect, Layer } from "effect";
import { simpleGit } from "simple-git";
import { describe, expect, it } from "vitest";

import { PullRequestService } from "../src/pull-request";
import { foldSessionStatuses } from "../src/pull-request/statuses";
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
  body: "",
};

const unusedInbox = {
  list: () => Effect.succeed([]),
  detail: () => Effect.succeed(null),
  diffFor: () => Effect.die("unexpected pull request diffFor"),
};

const quietPullRequestLayer = Layer.succeed(PullRequestService, {
  current: () => Effect.succeed(null),
  diff: () => Effect.succeed({ patch: "", truncated: false }),
  runAction: () => Effect.die("unexpected pull request action"),
  sessionStatuses: (workspaces) => foldSessionStatuses(workspaces, () => Effect.succeed(null)),
  ...unusedInbox,
});

describe("pull request router", () => {
  it("resolves SessionRef to the persisted worktree and returns action acknowledgement", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "pie-pr-home-"));
    const workspace = await makeRepository();
    let receivedCwd: string | undefined;
    const current = (cwd: string) => {
      receivedCwd = cwd;
      return Effect.succeed(snapshot);
    };
    const pullRequestLayer = Layer.succeed(PullRequestService, {
      current,
      diff: (cwd) => {
        receivedCwd = cwd;
        return Effect.succeed({ patch: "diff --git a/a.txt b/a.txt\n", truncated: false });
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
      sessionStatuses: (workspaces) => foldSessionStatuses(workspaces, current),
      ...unusedInbox,
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
      await expect(harness.client.pullRequest.diff({ ref: created.ref })).resolves.toEqual({
        patch: "diff --git a/a.txt b/a.txt\n",
        truncated: false,
      });
      expect(receivedCwd).toBe(created.workspace.cwd);
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
    const current = (cwd: string) => {
      receivedCwds.push(cwd);
      return Effect.succeed({ ...snapshot, lifecycle: { type: "merged" } as const });
    };
    const pullRequestLayer = Layer.succeed(PullRequestService, {
      current,
      diff: () => Effect.die("unexpected pull request diff"),
      runAction: () => Effect.die("unexpected pull request action"),
      sessionStatuses: (workspaces) => foldSessionStatuses(workspaces, current),
      ...unusedInbox,
    });
    const harness = await makeRpcTestHarness(home, { pullRequestLayer });
    try {
      const project = await harness.client.project.create({ path: workspace });
      const first = await harness.client.agent.session.create({ projectId: project.id });
      const second = await harness.client.agent.session.create({ projectId: project.id });

      await expect(
        harness.client.pullRequest.statuses({ refs: [first.ref, second.ref] }),
      ).resolves.toEqual([
        { ref: first.ref, lifecycle: { type: "merged" }, url: snapshot.url },
        { ref: second.ref, lifecycle: { type: "merged" }, url: snapshot.url },
      ]);
      expect(receivedCwds).toEqual([workspace]);
    } finally {
      await harness.dispose();
    }
  });

  it("persists the current pull request and rereads stored refs by number", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "pie-pr-home-"));
    const workspace = await makeRepository();
    const received: Array<{ cwd: string; number: number | undefined }> = [];
    const current = (cwd: string, pullRequest?: PullRequestSnapshot["ref"]) => {
      received.push({ cwd, number: pullRequest?.number });
      return Effect.succeed(
        pullRequest === undefined
          ? { ...snapshot, lifecycle: { type: "merged" } as const }
          : { ...snapshot, lifecycle: { type: "open", draft: false } as const },
      );
    };
    const pullRequestLayer = Layer.succeed(PullRequestService, {
      current,
      diff: () => Effect.die("unexpected pull request diff"),
      runAction: () => Effect.die("unexpected pull request action"),
      sessionStatuses: (workspaces) => foldSessionStatuses(workspaces, current),
      ...unusedInbox,
    });
    const harness = await makeRpcTestHarness(home, { pullRequestLayer });
    try {
      const project = await harness.client.project.create({ path: workspace });
      const first = await harness.client.agent.session.create({ projectId: project.id });
      const second = await harness.client.agent.session.create({ projectId: project.id });

      await expect(harness.client.pullRequest.current({ ref: first.ref })).resolves.toMatchObject({
        ref: snapshot.ref,
        lifecycle: { type: "merged" },
      });
      const stored = JSON.parse(
        fs.readFileSync(
          path.join(home, "storage", "sessions", project.id, `${first.ref.sessionId}.json`),
          "utf8",
        ),
      ) as { data: { pullRequestRefs?: unknown } };
      expect(stored.data.pullRequestRefs).toEqual([snapshot.ref]);

      received.length = 0;
      await expect(
        harness.client.pullRequest.statuses({ refs: [first.ref, second.ref] }),
      ).resolves.toEqual([
        { ref: first.ref, lifecycle: { type: "open", draft: false }, url: snapshot.url },
        { ref: second.ref, lifecycle: { type: "merged" }, url: snapshot.url },
      ]);
      expect(received).toEqual([
        { cwd: first.workspace.cwd, number: snapshot.ref.number },
        { cwd: workspace, number: undefined },
      ]);
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

  it("lists and details pull requests without a session", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "pie-pr-home-"));
    const item = {
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
    const detailed = { ...snapshot, body: "## Summary" };
    const pullRequestLayer = Layer.succeed(PullRequestService, {
      current: () => Effect.die("unexpected current"),
      diff: () => Effect.die("unexpected pull request diff"),
      diffFor: () => Effect.die("unexpected pull request diffFor"),
      runAction: () => Effect.die("unexpected pull request action"),
      sessionStatuses: () => Effect.die("unexpected statuses"),
      list: () => Effect.succeed([item]),
      detail: (pullRequest) =>
        Effect.succeed(pullRequest.number === snapshot.ref.number ? detailed : null),
    });
    const harness = await makeRpcTestHarness(home, { pullRequestLayer });
    try {
      await expect(harness.client.pullRequest.list()).resolves.toEqual([item]);
      await expect(
        harness.client.pullRequest.detail({ pullRequest: snapshot.ref }),
      ).resolves.toEqual(detailed);
    } finally {
      await harness.dispose();
    }
  });
});
