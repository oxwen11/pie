import { Effect, Sink, Stream } from "effect";
import { ChildProcessSpawner } from "effect/unstable/process";
import { describe, expect, it } from "vitest";

import {
  CURRENT_PULL_REQUEST_FIELDS,
  currentPullRequestArgs,
  makeGitHubCliAdapter,
  PULL_REQUEST_LIST_QUERY,
  pullRequestActionArgs,
  pullRequestDiffArgs,
  pullRequestListArgs,
} from "../src/pull-request/github-cli";

describe("GitHub CLI command construction", () => {
  it("reads the current branch pull request patch without color", () => {
    expect(pullRequestDiffArgs()).toEqual(["pr", "diff", "--color", "never"]);
  });

  it("reads a pull request patch by URL", () => {
    expect(
      pullRequestDiffArgs({
        host: "github.com",
        owner: "getpie",
        repository: "pie",
        number: 42,
      }),
    ).toEqual(["pr", "diff", "https://github.com/getpie/pie/pull/42", "--color", "never"]);
  });

  it("uses one fixed current-PR read without an auth preflight", () => {
    expect(currentPullRequestArgs()).toEqual([
      "pr",
      "view",
      "--json",
      CURRENT_PULL_REQUEST_FIELDS.join(","),
    ]);
  });

  it("lists the authenticated user's open pull requests through GraphQL", () => {
    expect(pullRequestListArgs()).toEqual([
      "api",
      "graphql",
      "-f",
      `query=${PULL_REQUEST_LIST_QUERY}`,
    ]);
  });

  it("views a stored pull request by URL", () => {
    expect(
      currentPullRequestArgs({
        host: "github.com",
        owner: "getpie",
        repository: "pie",
        number: 42,
      }),
    ).toEqual([
      "pr",
      "view",
      "https://github.com/getpie/pie/pull/42",
      "--json",
      CURRENT_PULL_REQUEST_FIELDS.join(","),
    ]);
  });

  it("spawns gh directly in the resolved cwd with prompts disabled", async () => {
    const output = JSON.stringify({
      autoMergeRequest: null,
      baseRefName: "main",
      headRefName: "feature/pr-status",
      headRefOid: "head-sha",
      isDraft: true,
      mergeable: "MERGEABLE",
      number: 42,
      reviewDecision: "",
      state: "OPEN",
      statusCheckRollup: [],
      title: "Pull request status",
      updatedAt: "2026-08-30T00:00:00Z",
      url: "https://github.com/getpie/pie/pull/42",
    });
    let recorded:
      | Parameters<ChildProcessSpawner.ChildProcessSpawner["Service"]["spawn"]>[0]
      | null = null;
    const handle = ChildProcessSpawner.makeHandle({
      pid: ChildProcessSpawner.ProcessId(1),
      exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(0)),
      isRunning: Effect.succeed(false),
      kill: () => Effect.void,
      stdin: Sink.drain,
      stdout: Stream.succeed(new TextEncoder().encode(output)),
      stderr: Stream.empty,
      all: Stream.succeed(new TextEncoder().encode(output)),
      getInputFd: () => Sink.drain,
      getOutputFd: () => Stream.empty,
      unref: Effect.succeed(Effect.void),
    });
    const spawner = ChildProcessSpawner.make((command) => {
      recorded = command;
      return Effect.succeed(handle);
    });

    await Effect.runPromise(makeGitHubCliAdapter(spawner).current("/workspace"));

    expect(recorded).toMatchObject({
      _tag: "StandardCommand",
      command: "gh",
      args: currentPullRequestArgs(),
      options: {
        cwd: "/workspace",
        env: { GH_PROMPT_DISABLED: "1" },
        extendEnv: true,
        stdin: "ignore",
      },
    });
  });

  it("lists the viewer's pull requests without a workspace cwd", async () => {
    const output = JSON.stringify({ data: { viewer: { pullRequests: { nodes: [] } } } });
    let recorded:
      | Parameters<ChildProcessSpawner.ChildProcessSpawner["Service"]["spawn"]>[0]
      | null = null;
    const handle = ChildProcessSpawner.makeHandle({
      pid: ChildProcessSpawner.ProcessId(3),
      exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(0)),
      isRunning: Effect.succeed(false),
      kill: () => Effect.void,
      stdin: Sink.drain,
      stdout: Stream.succeed(new TextEncoder().encode(output)),
      stderr: Stream.empty,
      all: Stream.succeed(new TextEncoder().encode(output)),
      getInputFd: () => Sink.drain,
      getOutputFd: () => Stream.empty,
      unref: Effect.succeed(Effect.void),
    });
    const spawner = ChildProcessSpawner.make((command) => {
      recorded = command;
      return Effect.succeed(handle);
    });

    await Effect.runPromise(makeGitHubCliAdapter(spawner).list());

    expect(recorded).toMatchObject({
      _tag: "StandardCommand",
      command: "gh",
      args: pullRequestListArgs(),
      options: {
        env: { GH_PROMPT_DISABLED: "1" },
        extendEnv: true,
        stdin: "ignore",
      },
    });
    expect(recorded).not.toMatchObject({ options: { cwd: expect.anything() } });
  });

  it("pins merge and auto-merge to the expected head commit", () => {
    const url = "https://github.com/getpie/pie/pull/42";
    expect(pullRequestActionArgs(url, { type: "merge", method: "squash" }, "expected-sha")).toEqual(
      ["pr", "merge", url, "--squash", "--match-head-commit", "expected-sha"],
    );
    expect(
      pullRequestActionArgs(url, { type: "enable-auto-merge", method: "rebase" }, "expected-sha"),
    ).toEqual(["pr", "merge", url, "--rebase", "--auto", "--match-head-commit", "expected-sha"]);
  });

  it("treats an unclassified non-zero action exit as an unknown outcome", async () => {
    const handle = ChildProcessSpawner.makeHandle({
      pid: ChildProcessSpawner.ProcessId(2),
      exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(1)),
      isRunning: Effect.succeed(false),
      kill: () => Effect.void,
      stdin: Sink.drain,
      stdout: Stream.empty,
      stderr: Stream.succeed(new TextEncoder().encode("network connection reset")),
      all: Stream.succeed(new TextEncoder().encode("network connection reset")),
      getInputFd: () => Sink.drain,
      getOutputFd: () => Stream.empty,
      unref: Effect.succeed(Effect.void),
    });
    const spawner = ChildProcessSpawner.make(() => Effect.succeed(handle));

    const error = await Effect.runPromise(
      Effect.flip(
        makeGitHubCliAdapter(spawner).runAction({
          cwd: "/workspace",
          url: "https://github.com/getpie/pie/pull/42",
          action: { type: "merge", method: "squash" },
          expectedHeadSha: "expected-sha",
        }),
      ),
    );

    expect(error._tag).toBe("PullRequestActionOutcomeUnknown");
  });

  it("does not invent a head precondition for disabling auto-merge", () => {
    expect(
      pullRequestActionArgs("https://github.com/getpie/pie/pull/42", {
        type: "disable-auto-merge",
      }),
    ).toEqual(["pr", "merge", "https://github.com/getpie/pie/pull/42", "--disable-auto"]);
  });
});
