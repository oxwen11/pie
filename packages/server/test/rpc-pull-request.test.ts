import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { PullRequestSnapshot } from "@getpie/contract/pull-request";
import { Effect, Layer } from "effect";
import { simpleGit } from "simple-git";
import { describe, expect, it } from "vitest";

import { PullRequestService } from "../src/pull-request";
import { PullRequestUnsupportedAction } from "../src/pull-request/errors";
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
  title: "Test PR",
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
const makeReader = () => {
  const calls: Array<{ type: string; cwd: string; number?: number }> = [];
  const layer = Layer.succeed(PullRequestService, {
    current: (cwd: string, ref?: typeof snapshot.ref) => {
      calls.push({ type: "current", cwd, ...(ref ? { number: ref.number } : undefined) });
      return Effect.succeed(snapshot);
    },
    summary: (cwd: string, ref: typeof snapshot.ref) => {
      calls.push({ type: "summary", cwd, number: ref.number });
      return Effect.succeed({
        ref,
        title: snapshot.title,
        headBranch: snapshot.head.branch,
        baseBranch: snapshot.baseBranch,
        lifecycle: snapshot.lifecycle,
        checkedAt: snapshot.updatedAt,
      });
    },
    discover: (cwd: string) => {
      calls.push({ type: "discover", cwd });
      return Effect.succeed(null);
    },
    stack: (cwd: string) => {
      calls.push({ type: "stack", cwd });
      return Effect.succeed(null);
    },
    stackPreview: () => Effect.fail(new PullRequestUnsupportedAction()),
    runStackAction: () => Effect.fail(new PullRequestUnsupportedAction()),
    runAction: (
      cwd: string,
      _expected: unknown,
      action: { type: "merge" | "enable-auto-merge" | "disable-auto-merge" },
    ) => {
      calls.push({ type: "action", cwd });
      return Effect.succeed({ pullRequest: snapshot.ref, action: action.type });
    },
  });
  return { calls, layer };
};
describe("pull request RPC composition", () => {
  it("reads cached statuses with no remote lookup and keeps current read free of association side effects", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "pie-pr-home-"));
    const workspace = await makeRepository();
    const reader = makeReader();
    const harness = await makeRpcTestHarness(home, { pullRequestLayer: reader.layer });
    try {
      const project = await harness.client.project.create({ path: workspace });
      const created = await harness.client.agent.session.create({ projectId: project.id });
      await expect(harness.client.pullRequest.statuses({ refs: [created.ref] })).resolves.toEqual([
        { ref: created.ref, links: [], state: "unbound" },
      ]);
      expect(reader.calls).toEqual([]);
      await expect(harness.client.pullRequest.current({ ref: created.ref })).resolves.toEqual(
        snapshot,
      );
      const statuses = await harness.client.pullRequest.statuses({ refs: [created.ref] });
      expect(statuses[0]?.links).toEqual([]);
      expect(reader.calls).toEqual([{ type: "current", cwd: workspace }]);
    } finally {
      await harness.dispose();
      fs.rmSync(home, { recursive: true, force: true });
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });
  it("persists Agent registration synchronously and refreshes explicit identities using the Project directory", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "pie-pr-home-"));
    const workspace = await makeRepository();
    const reader = makeReader();
    const harness = await makeRpcTestHarness(home, { pullRequestLayer: reader.layer });
    try {
      const project = await harness.client.project.create({ path: workspace });
      const created = await harness.client.agent.session.create({
        projectId: project.id,
        worktree: {},
      });
      await expect(
        Effect.runPromise(harness.sessions.registerPullRequest(created.ref, snapshot.ref)),
      ).resolves.toBe("linked");
      expect(reader.calls).toEqual([]);
      const cached = await harness.client.pullRequest.statuses({ refs: [created.ref] });
      expect(cached[0]?.links[0]?.snapshot).toBeNull();
      const refreshed = await harness.client.pullRequest.refresh({ ref: created.ref });
      expect(refreshed.links[0]?.snapshot?.title).toBe(snapshot.title);
      expect(
        reader.calls
          .filter((call) => call.type !== "discover")
          .every((call) => call.cwd === workspace),
      ).toBe(true);
      expect(reader.calls.find((call) => call.type === "discover")?.cwd).toBe(
        created.workspace.cwd,
      );
      await harness.client.agent.session.archive({ ref: created.ref, archived: true });
      await expect(
        harness.client.pullRequest.detail({ ref: created.ref, pullRequest: snapshot.ref }),
      ).resolves.toEqual(snapshot);
      await harness.client.pullRequest.exclude({ ref: created.ref, pullRequest: snapshot.ref });
      await expect(
        harness.client.pullRequest.detail({ ref: created.ref, pullRequest: snapshot.ref }),
      ).rejects.toMatchObject({ code: "STALE_CONTEXT" });
      await expect(
        Effect.runPromise(harness.sessions.registerPullRequest(created.ref, snapshot.ref, "stack")),
      ).resolves.toBe("excluded");
    } finally {
      await harness.dispose();
      fs.rmSync(home, { recursive: true, force: true });
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });
  it("returns per-session errors and rejects invalid demand without remote reads", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "pie-pr-home-"));
    const reader = makeReader();
    const harness = await makeRpcTestHarness(home, { pullRequestLayer: reader.layer });
    try {
      const ref = {
        projectId: "00000000-0000-4000-8000-000000000001",
        sessionId: "00000000-0000-4000-8000-000000000002",
      };
      const statuses = await harness.client.pullRequest.statuses({ refs: [ref] });
      expect(statuses[0]?.state).toBe("error");
      await expect(
        harness.client.pullRequest.demand({ refs: [ref], version: 0 }),
      ).rejects.toMatchObject({ code: "INVALID_LEASE" });
      expect(reader.calls).toEqual([]);
    } finally {
      await harness.dispose();
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});
