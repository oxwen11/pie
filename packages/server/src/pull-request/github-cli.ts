import type {
  PullRequestAction,
  PullRequestMergeMethod,
  PullRequestRef,
  PullRequestSnapshot,
  PullRequestSummary,
  PullRequestStack,
  PullRequestStackAction,
  PullRequestStackExpected,
  PullRequestStackPreview,
  PullRequestStackActionResult,
} from "@getpie/contract/pull-request";
import { Clock, Effect } from "effect";
import type { ChildProcessSpawner } from "effect/unstable/process";

import {
  PullRequestActionOutcomeUnknown,
  PullRequestHostRejected,
  PullRequestHostUnavailable,
  PullRequestInvalidResponse,
  PullRequestMissingGh,
  PullRequestRateLimited,
  PullRequestStaleContext,
  PullRequestUnauthenticated,
  PullRequestUnsupportedAction,
  PullRequestUnsupportedContext,
} from "./errors";
import { executeGitHubCommand, type GitHubCliExecutionError } from "./github-command";
import { makeGitHubStack } from "./github-stack";
import {
  SUMMARY_PULL_REQUEST_FIELDS,
  decodeSummary,
  decodeDiscovery,
  repositoryFromBranchConfig,
} from "./github-summary";
import { normalizeGitHubPullRequestJson } from "./normalization";

export const CURRENT_PULL_REQUEST_FIELDS = [
  "number",
  "url",
  "title",
  "state",
  "isDraft",
  "headRefName",
  "headRefOid",
  "baseRefName",
  "mergeable",
  "statusCheckRollup",
  "reviewDecision",
  "autoMergeRequest",
  "updatedAt",
] as const;

export const pullRequestViewUrl = (ref: PullRequestRef): string =>
  `https://${ref.host}/${ref.owner}/${ref.repository}/pull/${ref.number}`;

export const currentPullRequestArgs = (pullRequest?: PullRequestRef): ReadonlyArray<string> =>
  pullRequest === undefined
    ? ["pr", "view", "--json", CURRENT_PULL_REQUEST_FIELDS.join(",")]
    : [
        "pr",
        "view",
        pullRequestViewUrl(pullRequest),
        "--json",
        CURRENT_PULL_REQUEST_FIELDS.join(","),
      ];

const mergeMethodFlag = (method: PullRequestMergeMethod): string => `--${method}`;

export const pullRequestActionArgs = (
  url: string,
  action: PullRequestAction,
  expectedHeadSha?: string,
): ReadonlyArray<string> => {
  if (action.type === "disable-auto-merge") {
    return ["pr", "merge", url, "--disable-auto"];
  }
  if (expectedHeadSha === undefined) {
    throw new Error(`invariant: ${action.type} requires an expected head sha`);
  }
  return [
    "pr",
    "merge",
    url,
    mergeMethodFlag(action.method),
    ...(action.type === "enable-auto-merge" ? ["--auto"] : []),
    "--match-head-commit",
    expectedHeadSha,
  ];
};

const isUnauthenticated = (stderr: string): boolean =>
  /not logged into any github hosts|gh auth login|authentication required|bad credentials|http 401/i.test(
    stderr,
  );

const isRateLimited = (stderr: string): boolean =>
  /rate limit|secondary rate limit|http 429/i.test(stderr);

const isUnsupportedContext = (stderr: string): boolean =>
  /not a git repository|no git remotes found|detached head|not on any branch|unable to resolve current branch/i.test(
    stderr,
  );

const isNoPullRequest = (stderr: string): boolean =>
  /no pull requests found(?: for branch)?|could not find pull request/i.test(stderr);

const isUnsupportedHeadFlag = (stderr: string): boolean =>
  /unknown flag:\s*--match-head-commit|unknown shorthand flag.*match-head-commit/i.test(stderr);

const isStaleHead = (stderr: string): boolean =>
  /(head|oid|sha).*(does not match|expected)|(does not match|expected).*(head|oid|sha)/i.test(
    stderr,
  );

const isConfirmedHostRejection = (stderr: string): boolean =>
  /pull request .* is not mergeable|not allowed to merge|merge method .* not allowed|branch protection|required status check|required approving review|must be approved|merge queue|resource not accessible|permission denied|forbidden/i.test(
    stderr,
  );

export type PullRequestReadFailure =
  | PullRequestMissingGh
  | PullRequestUnauthenticated
  | PullRequestRateLimited
  | PullRequestUnsupportedContext
  | PullRequestHostUnavailable
  | PullRequestInvalidResponse;

export type PullRequestCliActionFailure =
  | PullRequestMissingGh
  | PullRequestUnauthenticated
  | PullRequestRateLimited
  | PullRequestUnsupportedContext
  | PullRequestUnsupportedAction
  | PullRequestActionOutcomeUnknown
  | PullRequestStaleContext
  | PullRequestHostRejected;

export interface GitHubCliAdapter {
  readonly summary: (
    cwd: string,
    pullRequest: PullRequestRef,
  ) => Effect.Effect<PullRequestSummary | null, PullRequestReadFailure>;
  readonly discover: (
    cwd: string,
    branch: string,
  ) => Effect.Effect<PullRequestSummary | null, PullRequestReadFailure>;
  readonly stack: (
    cwd: string,
    pullRequest: PullRequestRef,
  ) => Effect.Effect<PullRequestStack | null, PullRequestReadFailure>;
  readonly stackPreview: (
    cwd: string,
    pullRequest: PullRequestRef,
    action: PullRequestStackAction,
  ) => Effect.Effect<
    PullRequestStackPreview,
    PullRequestReadFailure | PullRequestUnsupportedAction
  >;
  readonly runStackAction: (
    cwd: string,
    pullRequest: PullRequestRef,
    action: PullRequestStackAction,
    expected: PullRequestStackExpected,
    method?: PullRequestMergeMethod,
  ) => Effect.Effect<
    PullRequestStackActionResult,
    PullRequestReadFailure | PullRequestCliActionFailure
  >;

  readonly current: (
    cwd: string,
    pullRequest?: PullRequestRef,
  ) => Effect.Effect<PullRequestSnapshot | null, PullRequestReadFailure>;
  readonly runAction: (input: {
    readonly cwd: string;
    readonly url: string;
    readonly action: PullRequestAction;
    readonly expectedHeadSha?: string;
  }) => Effect.Effect<void, PullRequestCliActionFailure>;
}

export const mapExecutionReadError = (error: GitHubCliExecutionError): PullRequestReadFailure =>
  error._tag === "GitHubCliExecutableMissing"
    ? new PullRequestMissingGh()
    : new PullRequestHostUnavailable();

export const mapExecutionActionError = (
  error: GitHubCliExecutionError,
): PullRequestCliActionFailure =>
  error._tag === "GitHubCliExecutableMissing"
    ? new PullRequestMissingGh()
    : new PullRequestActionOutcomeUnknown();

export const makeGitHubCliAdapter = (
  spawner: ChildProcessSpawner.ChildProcessSpawner["Service"],
): GitHubCliAdapter => {
  const read = (
    cwd: string,
    args: ReadonlyArray<string>,
    missing = false,
    program: "gh" | "git" = "gh",
  ) =>
    executeGitHubCommand(spawner, cwd, args, program).pipe(
      Effect.mapError(mapExecutionReadError),
      Effect.flatMap((result): Effect.Effect<string | null, PullRequestReadFailure> => {
        if (result.exitCode === 0) return Effect.succeed(result.stdout);
        if (isUnauthenticated(result.stderr)) return Effect.fail(new PullRequestUnauthenticated());
        if (isRateLimited(result.stderr)) return Effect.fail(new PullRequestRateLimited());
        if (isUnsupportedContext(result.stderr))
          return Effect.fail(new PullRequestUnsupportedContext());
        if (
          missing &&
          (isNoPullRequest(result.stderr) || /HTTP 404|Not Found \(HTTP 404\)/i.test(result.stderr))
        )
          return Effect.succeed(null);
        return Effect.fail(new PullRequestHostUnavailable());
      }),
    );
  const json = (raw: string | null) =>
    Effect.try({
      try: (): unknown => (raw === null ? null : JSON.parse(raw)),
      catch: () => new PullRequestInvalidResponse(),
    });
  const stackFor = (cwd: string) =>
    makeGitHubStack(
      (args, missing) => read(cwd, args, missing).pipe(Effect.flatMap(json)),
      (args) =>
        executeGitHubCommand(spawner, cwd, args).pipe(
          Effect.mapError(mapExecutionActionError),
          Effect.flatMap((result): Effect.Effect<unknown, PullRequestCliActionFailure> => {
            if (result.exitCode !== 0 || /"errors"\s*:/.test(result.stdout)) {
              const error = result.stderr + result.stdout;
              if (isUnauthenticated(error)) return Effect.fail(new PullRequestUnauthenticated());
              if (isRateLimited(error)) return Effect.fail(new PullRequestRateLimited());
              if (isStaleHead(error)) return Effect.fail(new PullRequestStaleContext());
              if (isConfirmedHostRejection(error))
                return Effect.fail(new PullRequestHostRejected());
              return Effect.fail(new PullRequestActionOutcomeUnknown());
            }
            return Effect.try({
              try: (): unknown => JSON.parse(result.stdout),
              catch: () => new PullRequestActionOutcomeUnknown(),
            });
          }),
        ),
    );
  return {
    summary: (cwd, ref) =>
      Effect.gen(function* () {
        const raw = yield* read(
          cwd,
          ["pr", "view", pullRequestViewUrl(ref), "--json", SUMMARY_PULL_REQUEST_FIELDS.join(",")],
          true,
        );
        if (raw === null) return null;
        const checkedAt = new Date(yield* Clock.currentTimeMillis).toISOString();
        return yield* Effect.try({
          try: () => decodeSummary(JSON.parse(raw), checkedAt, ref),
          catch: () => new PullRequestInvalidResponse(),
        });
      }),
    discover: (cwd, branch) =>
      Effect.gen(function* () {
        const config = yield* read(
          cwd,
          [
            "config",
            "--null",
            "--get-regexp",
            String.raw`^(remote\..*\.url|branch\..*\.(remote|merge))$`,
          ],
          false,
          "git",
        );
        const repo = yield* Effect.try({
          try: () => repositoryFromBranchConfig(config ?? "", branch),
          catch: () => new PullRequestUnsupportedContext(),
        });
        const url = `https://${repo.host}/${repo.owner}/${repo.repository}`;
        const metadata = yield* read(cwd, ["repo", "view", url, "--json", "defaultBranchRef"]);
        const defaultBranch = yield* Effect.try({
          try: () => {
            const value = JSON.parse(metadata ?? "null") as {
              defaultBranchRef?: { name?: unknown };
            };
            if (typeof value?.defaultBranchRef?.name !== "string")
              throw new Error("Missing default branch");
            return value.defaultBranchRef.name;
          },
          catch: () => new PullRequestInvalidResponse(),
        });
        if (branch === defaultBranch) return null;
        const raw = yield* read(cwd, [
          "pr",
          "list",
          "--repo",
          url,
          "--head",
          branch,
          "--state",
          "all",
          "--limit",
          "2",
          "--json",
          [...SUMMARY_PULL_REQUEST_FIELDS, "headRepository", "headRepositoryOwner"].join(","),
        ]);
        const checkedAt = new Date(yield* Clock.currentTimeMillis).toISOString();
        return yield* Effect.try({
          try: () => decodeDiscovery(JSON.parse(raw ?? "null"), branch, repo, checkedAt),
          catch: () => new PullRequestUnsupportedContext(),
        });
      }),
    stack: (cwd, ref) => stackFor(cwd).stack(ref),
    stackPreview: (cwd, ref, action) => stackFor(cwd).preview(ref, action),
    runStackAction: (cwd, ref, action, expected) => stackFor(cwd).run(ref, action, expected),
    current: (cwd, pullRequest) =>
      executeGitHubCommand(spawner, cwd, currentPullRequestArgs(pullRequest)).pipe(
        Effect.mapError(mapExecutionReadError),
        Effect.flatMap(
          (result): Effect.Effect<PullRequestSnapshot | null, PullRequestReadFailure> => {
            if (result.exitCode !== 0) {
              if (isNoPullRequest(result.stderr)) return Effect.succeed(null);
              if (isUnauthenticated(result.stderr)) {
                return Effect.fail(new PullRequestUnauthenticated());
              }
              if (isRateLimited(result.stderr)) return Effect.fail(new PullRequestRateLimited());
              if (isUnsupportedContext(result.stderr)) {
                return Effect.fail(new PullRequestUnsupportedContext());
              }
              return Effect.fail(new PullRequestHostUnavailable());
            }
            return Effect.try({
              try: () => normalizeGitHubPullRequestJson(JSON.parse(result.stdout) as unknown),
              catch: () => new PullRequestInvalidResponse(),
            });
          },
        ),
      ),
    runAction: ({ action, cwd, expectedHeadSha, url }) =>
      executeGitHubCommand(spawner, cwd, pullRequestActionArgs(url, action, expectedHeadSha)).pipe(
        Effect.mapError(mapExecutionActionError),
        Effect.flatMap((result): Effect.Effect<void, PullRequestCliActionFailure> => {
          if (result.exitCode === 0) return Effect.void;
          if (isUnauthenticated(result.stderr)) {
            return Effect.fail(new PullRequestUnauthenticated());
          }
          if (isRateLimited(result.stderr)) return Effect.fail(new PullRequestRateLimited());
          if (isUnsupportedContext(result.stderr)) {
            return Effect.fail(new PullRequestUnsupportedContext());
          }
          if (isUnsupportedHeadFlag(result.stderr)) {
            return Effect.fail(new PullRequestUnsupportedAction());
          }
          if (isStaleHead(result.stderr)) return Effect.fail(new PullRequestStaleContext());
          if (isConfirmedHostRejection(result.stderr)) {
            return Effect.fail(new PullRequestHostRejected());
          }
          return Effect.fail(new PullRequestActionOutcomeUnknown());
        }),
      ),
  };
};
