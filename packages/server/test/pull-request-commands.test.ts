import assert from "node:assert/strict";

import { it } from "@effect/vitest";
import type { PullRequestRef, PullRequestStackExpected } from "@getpie/contract/pull-request";
import { Context, Effect, Fiber, Layer, Sink, Stream } from "effect";
import { TestClock } from "effect/testing";
import { ChildProcessSpawner } from "effect/unstable/process";

import { makeGitHubCliAdapter } from "../src/pull-request/github-cli";
import { SUMMARY_PULL_REQUEST_FIELDS } from "../src/pull-request/github-summary";
import { PullRequestService, PullRequestServiceLayer } from "../src/pull-request/service";

const ref: PullRequestRef = { host: "github.com", owner: "getpie", repository: "pie", number: 9 };
const lower = { ...ref, number: 41 };
const expected: PullRequestStackExpected = {
  stackId: "native-stack",
  baseBranch: "main",
  members: [
    { pullRequest: lower, headBranch: "lower", headSha: "lower-head" },
    { pullRequest: ref, headBranch: "upper", headSha: "upper-head" },
  ],
};
const summary = {
  number: 9,
  url: "https://github.com/getpie/pie/pull/9",
  title: "PR",
  state: "OPEN",
  isDraft: false,
  headRefName: "feature",
  baseRefName: "main",
};
const stack = (bottom = "lower-head", upper = "upper-head") => [
  {
    id: "native-stack",
    number: 3,
    base: { ref: "main" },
    pull_requests: [
      {
        number: 41,
        head: { ref: "lower", sha: bottom },
        state: "open",
        draft: false,
        merged_at: null,
      },
      {
        number: 9,
        head: { ref: "upper", sha: upper },
        state: "open",
        draft: false,
        merged_at: null,
      },
    ],
  },
];
const access = (bottom = "lower-head", upper = "upper-head", permission = "WRITE", behind = 1) => ({
  data: {
    __type: { inputFields: [{ name: "expectedHeadOid" }, { name: "updateMethod" }] },
    repository: {
      viewerPermission: "WRITE",
      ...Object.fromEntries(
        [
          [41, bottom],
          [9, upper],
        ].map(([number, head]) => [
          `pr${number}`,
          {
            id: `id-${number}`,
            headRefOid: head,
            baseRef: { compare: { behindBy: behind } },
            headRepository: { viewerPermission: permission },
            maintainerCanModify: false,
          },
        ]),
      ),
    },
  },
});
const updated = (head: string) => ({
  data: { updatePullRequestBranch: { pullRequest: { headRefOid: head } } },
});

interface Reply {
  readonly output?: unknown;
  readonly raw?: string;
  readonly stderr?: string;
  readonly code?: number;
  readonly hang?: boolean;
}
const scripted = (replies: ReadonlyArray<Reply>) => {
  const calls: { program: string; args: ReadonlyArray<string> }[] = [];
  const spawner = ChildProcessSpawner.make((command) =>
    Effect.sync(() => {
      assert.equal(command._tag, "StandardCommand");
      if (command._tag !== "StandardCommand") throw new Error("Unexpected pipeline");
      assert.equal(command.options?.cwd, "/workspace");
      assert.equal(command.options?.stdin, "ignore");
      calls.push({ program: command.command, args: command.args });
      const reply = replies[calls.length - 1];
      assert.ok(reply, `Unexpected command ${command.command} ${command.args.join(" ")}`);
      const stdout = new TextEncoder().encode(reply.raw ?? JSON.stringify(reply.output ?? {}));
      return ChildProcessSpawner.makeHandle({
        pid: ChildProcessSpawner.ProcessId(calls.length),
        exitCode: reply.hang
          ? Effect.never
          : Effect.succeed(ChildProcessSpawner.ExitCode(reply.code ?? 0)),
        isRunning: Effect.succeed(false),
        kill: () => Effect.void,
        stdin: Sink.drain,
        stdout: Stream.succeed(stdout),
        stderr: reply.stderr
          ? Stream.succeed(new TextEncoder().encode(reply.stderr))
          : Stream.empty,
        all: Stream.empty,
        getInputFd: () => Sink.drain,
        getOutputFd: () => Stream.empty,
        unref: Effect.succeed(Effect.void),
      });
    }),
  );
  return {
    calls,
    spawner,
    cli: makeGitHubCliAdapter(spawner),
    writes: () => calls.filter((call) => call.args.some((arg) => arg.startsWith("query=mutation"))),
  };
};

it.effect("summary asks for only badge fields and verifies exact identity", () =>
  Effect.gen(function* () {
    const fake = scripted([
      { output: summary },
      { output: { ...summary, number: 10, url: "https://github.com/getpie/pie/pull/10" } },
    ]);
    const value = yield* fake.cli.summary("/workspace", ref);
    assert.equal(value?.headBranch, "feature");
    assert.equal(value?.checkedAt, "1970-01-01T00:00:00.000Z");
    assert.deepEqual(fake.calls[0]?.args, [
      "pr",
      "view",
      summary.url,
      "--json",
      SUMMARY_PULL_REQUEST_FIELDS.join(","),
    ]);
    assert.equal(
      (yield* Effect.flip(fake.cli.summary("/workspace", ref)))._tag,
      "PullRequestInvalidResponse",
    );
  }),
);

const config =
  "remote.origin.url\ngit@github.com:getpie/pie.git\0branch.feature.remote\norigin\0branch.feature.merge\nrefs/heads/feature\0";
const discovered = {
  ...summary,
  headRepository: { nameWithOwner: "getpie/pie" },
  headRepositoryOwner: { login: "getpie" },
};
it.effect(
  "discovery reads the recorded branch with a repository-qualified bounded head query",
  () =>
    Effect.gen(function* () {
      const fake = scripted([
        { raw: config },
        { output: { defaultBranchRef: { name: "main" } } },
        { output: [discovered] },
      ]);
      assert.equal((yield* fake.cli.discover("/workspace", "feature"))?.ref.number, 9);
      assert.equal(fake.calls[0]?.program, "git");
      assert.deepEqual(fake.calls[2]?.args.slice(0, 11), [
        "pr",
        "list",
        "--repo",
        "https://github.com/getpie/pie",
        "--head",
        "feature",
        "--state",
        "all",
        "--limit",
        "2",
        "--json",
      ]);
      assert.equal(fake.calls.length, 3);
    }),
);

it.effect(
  "discovery refuses ambiguous remotes, same-head forks, multiple PRs, and default-branch scans",
  () =>
    Effect.gen(function* () {
      const remotes = scripted([
        {
          raw: "remote.origin.url\ngit@github.com:getpie/pie.git\0remote.other.url\ngit@github.com:other/pie.git\0",
        },
      ]);
      assert.equal(
        (yield* Effect.flip(remotes.cli.discover("/workspace", "feature")))._tag,
        "PullRequestUnsupportedContext",
      );
      assert.equal(remotes.calls.length, 1);
      for (const rows of [
        [{ ...discovered, headRepository: { nameWithOwner: "fork/pie" } }],
        [discovered, discovered],
      ]) {
        const fake = scripted([
          { raw: config },
          { output: { defaultBranchRef: { name: "main" } } },
          { output: rows },
        ]);
        assert.equal(
          (yield* Effect.flip(fake.cli.discover("/workspace", "feature")))._tag,
          "PullRequestUnsupportedContext",
        );
      }
      const main = scripted([{ raw: config }, { output: { defaultBranchRef: { name: "main" } } }]);
      assert.equal(yield* main.cli.discover("/workspace", "main"), null);
      assert.equal(main.calls.length, 2);
    }),
);

it.effect("native reads preserve host layer order and never store heads or fetch details", () =>
  Effect.gen(function* () {
    const fake = scripted([{ output: stack() }]);
    const value = yield* fake.cli.stack("/workspace", ref);
    assert.deepEqual(
      value?.layers.map((layer) => layer.ref.number),
      [41, 9],
    );
    assert.equal(JSON.stringify(value).includes("lower-head"), false);
    assert.deepEqual(fake.calls[0]?.args, [
      "api",
      "--hostname",
      "github.com",
      "repos/getpie/pie/stacks?pull_request=9",
    ]);
    assert.equal(fake.calls.length, 1);
  }),
);

it.effect("keeps preview membership with missing lifecycle fields unknown and read-only", () =>
  Effect.gen(function* () {
    const sparse = stack().map((item) => ({
      ...item,
      pull_requests: item.pull_requests.map(({ number, head }) => ({ number, head })),
    }));
    const fake = scripted([{ output: sparse }, { output: sparse }]);
    const topology = yield* fake.cli.stack("/workspace", ref);
    assert.deepEqual(
      topology?.layers.map((member) => member.lifecycle),
      [null, null],
    );
    const preview = yield* fake.cli.stackPreview("/workspace", ref, "rebase");
    assert.equal(preview.allowed, false);
    assert.equal(fake.calls.length, 2);
  }),
);

it.effect(
  "unsupported native hosts return null; transient, malformed and oversized stacks fail",
  () =>
    Effect.gen(function* () {
      const missing = scripted([{ code: 1, stderr: "HTTP 404 Not Found" }]);
      assert.equal(yield* missing.cli.stack("/workspace", ref), null);
      for (const reply of [
        { code: 1, stderr: "HTTP 503" },
        {
          output: [
            {
              ...stack()[0],
              pull_requests: Array.from({ length: 101 }, () => stack()[0]!.pull_requests[0]),
            },
          ],
        },
      ]) {
        const fake = scripted([reply]);
        const result = yield* Effect.result(fake.cli.stack("/workspace", ref));
        assert.equal(result._tag, "Failure");
      }
    }),
);

it.effect("merge preview names selected and lower layers and offers merge-async methods", () =>
  Effect.gen(function* () {
    const fake = scripted([
      { output: stack() },
      { output: access() },
      { output: stack() },
      { output: access() },
    ]);
    const preview = yield* fake.cli.stackPreview("/workspace", lower, "merge");
    assert.deepEqual(preview.affected, [lower]);
    assert.equal(preview.allowed, true);
    assert.deepEqual(preview.methods, ["merge", "squash", "rebase"]);
    assert.equal(fake.writes().length, 0);
    assert.equal(
      (yield* Effect.flip(fake.cli.runStackAction("/workspace", lower, "merge", expected)))._tag,
      "PullRequestUnsupportedAction",
    );
  }),
);

it.effect("confirmed merge uses merge-async with the selected head and does not retry", () =>
  Effect.gen(function* () {
    const fake = scripted([
      { output: stack() },
      { output: access() },
      {
        output: {
          status: "pending",
          details: { uuid: "merge-1" },
        },
      },
      { output: { status: "merged", details: { sha: "merge-commit" } } },
    ]);
    assert.deepEqual(
      yield* fake.cli.runStackAction("/workspace", lower, "merge", expected, "squash"),
      {
        action: "merge",
        completed: [lower],
        outcome: "applied",
      },
    );
    const put = fake.calls.find((call) => call.args.includes("PUT"));
    assert.deepEqual(put?.args.slice(put.args.indexOf("--method")), [
      "--method",
      "PUT",
      "repos/getpie/pie/pulls/41/merge-async",
      "-f",
      "sha=lower-head",
      "-f",
      "merge_method=squash",
    ]);
    assert.equal(fake.calls.filter((call) => call.args.includes("PUT")).length, 1);
    assert.ok(
      fake.calls.some((call) =>
        call.args.includes("repos/getpie/pie/pulls/41/merge-async/merge-1"),
      ),
    );
  }),
);

it.effect("a timed-out merge-async poll is unknown and never submits a second merge", () =>
  Effect.gen(function* () {
    const fake = scripted([
      { output: stack() },
      { output: access() },
      { output: { status: "pending", details: { uuid: "merge-1" } } },
      { hang: true },
    ]);
    const fiber = yield* fake.cli
      .runStackAction("/workspace", lower, "merge", expected, "squash")
      .pipe(Effect.forkChild);
    yield* TestClock.adjust("30 seconds");
    const result = yield* Fiber.join(fiber);
    assert.equal(result.outcome, "unknown");
    assert.deepEqual(result.completed, []);
    assert.equal(fake.calls.filter((call) => call.args.includes("PUT")).length, 1);
  }),
);

it.effect(
  "rebase preview preflights all branch permissions, expected heads and host capability",
  () =>
    Effect.gen(function* () {
      const fake = scripted([{ output: stack() }, { output: access() }]);
      const preview = yield* fake.cli.stackPreview("/workspace", ref, "rebase");
      assert.equal(preview.allowed, true);
      assert.deepEqual(preview.expected, expected);
      assert.deepEqual(preview.affected, [lower, ref]);
      assert.equal(fake.writes().length, 0);
      const denied = scripted([
        { output: stack() },
        { output: access("lower-head", "upper-head", "READ") },
      ]);
      assert.equal((yield* denied.cli.stackPreview("/workspace", ref, "rebase")).allowed, false);
    }),
);

it.effect("confirmation rejects changed heads and changed member order without a write", () =>
  Effect.gen(function* () {
    for (const confirmed of [
      { ...expected, members: expected.members.map((member) => ({ ...member, headSha: "old" })) },
      { ...expected, members: expected.members.toReversed() },
      { ...expected, baseBranch: "unexpected-base" },
      {
        ...expected,
        members: expected.members.map((member) => ({ ...member, headBranch: "renamed" })),
      },
    ]) {
      const fake = scripted([{ output: stack() }, { output: access() }]);
      assert.equal(
        (yield* Effect.flip(fake.cli.runStackAction("/workspace", ref, "rebase", confirmed)))._tag,
        "PullRequestStaleContext",
      );
      assert.equal(fake.writes().length, 0);
    }
  }),
);

it.effect(
  "confirmed rebase updates bottom to top with CAS and never changes the local checkout",
  () =>
    Effect.gen(function* () {
      const fake = scripted([
        { output: stack() },
        { output: access() },
        { output: stack() },
        { output: access() },
        { output: updated("lower-new") },
        { output: stack("lower-new") },
        { output: access("lower-new") },
        { output: updated("upper-new") },
      ]);
      assert.deepEqual(yield* fake.cli.runStackAction("/workspace", ref, "rebase", expected), {
        action: "rebase",
        completed: [lower, ref],
        outcome: "applied",
      });
      assert.equal(
        fake.calls.every((call) => call.program === "gh"),
        true,
      );
      assert.deepEqual(
        fake.writes().map((call) => call.args.filter((arg) => /^(id|sha)=/.test(arg))),
        [
          ["id=id-41", "sha=lower-head"],
          ["id=id-9", "sha=upper-head"],
        ],
      );
      assert.ok(
        fake
          .writes()
          .every((call) =>
            call.args.some((arg) => arg.includes("expectedHeadOid:$sha,updateMethod:REBASE")),
          ),
      );
    }),
);

it.effect(
  "a changed processed layer or known second-layer rejection reports partial completion and stops",
  () =>
    Effect.gen(function* () {
      for (const tail of [
        [{ output: stack("unexpected-push") }],
        [
          { output: stack("lower-new") },
          { output: access("lower-new") },
          { code: 1, stderr: "permission denied" },
        ],
      ]) {
        const fake = scripted([
          { output: stack() },
          { output: access() },
          { output: stack() },
          { output: access() },
          { output: updated("lower-new") },
          ...tail,
        ]);
        const result = yield* fake.cli.runStackAction("/workspace", ref, "rebase", expected);
        assert.equal(result.outcome, "partial");
        assert.deepEqual(result.completed, [lower]);
        assert.equal(fake.calls.length, 5 + tail.length);
      }
    }),
);

it.effect(
  "an unreadable mutation response reports unknown, preserves earlier completion, and never retries",
  () =>
    Effect.gen(function* () {
      const fake = scripted([
        { output: stack() },
        { output: access() },
        { output: stack() },
        { output: access() },
        { output: updated("lower-new") },
        { output: stack("lower-new") },
        { output: access("lower-new") },
        { raw: "not-json" },
      ]);
      const result = yield* fake.cli.runStackAction("/workspace", ref, "rebase", expected);
      assert.equal(result.outcome, "unknown");
      assert.deepEqual(result.completed, [lower]);
      assert.equal(fake.writes().length, 2);
    }),
);

it.effect(
  "a timed-out mutation returns unknown after the fixed command deadline without retry",
  () =>
    Effect.gen(function* () {
      const fake = scripted([
        { output: stack() },
        { output: access() },
        { output: stack() },
        { output: access() },
        { hang: true },
      ]);
      const fiber = yield* fake.cli
        .runStackAction("/workspace", ref, "rebase", expected)
        .pipe(Effect.forkChild);
      yield* TestClock.adjust("30 seconds");
      const result = yield* Fiber.join(fiber);
      assert.equal(result.outcome, "unknown");
      assert.deepEqual(result.completed, []);
      assert.equal(fake.writes().length, 1);
    }),
);

it.effect(
  "existing single PR actions still re-read CURRENT checkout and pin merge to expected head",
  () =>
    Effect.gen(function* () {
      const detail = {
        ...summary,
        headRefOid: "expected-sha",
        mergeable: "MERGEABLE",
        statusCheckRollup: [],
        reviewDecision: "",
        autoMergeRequest: null,
        updatedAt: "2026-09-14T00:00:00Z",
      };
      const fake = scripted([{ output: detail }, { output: {} }, { output: detail }]);
      const service = Context.get(
        yield* Layer.build(
          PullRequestServiceLayer.pipe(
            Layer.provide(Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, fake.spawner)),
          ),
        ),
        PullRequestService,
      );
      yield* service.runAction(
        "/workspace",
        { pullRequest: ref, headSha: "expected-sha" },
        { type: "merge", method: "squash" },
      );
      assert.equal(fake.calls[0]?.args.includes(summary.url), false);
      assert.deepEqual(fake.calls[1]?.args, [
        "pr",
        "merge",
        summary.url,
        "--squash",
        "--match-head-commit",
        "expected-sha",
      ]);
      assert.equal(
        (yield* Effect.flip(
          service.runAction(
            "/workspace",
            { pullRequest: lower, headSha: "expected-sha" },
            { type: "merge", method: "squash" },
          ),
        ))._tag,
        "PullRequestStaleContext",
      );
      assert.equal(fake.calls.length, 3);
    }),
);
