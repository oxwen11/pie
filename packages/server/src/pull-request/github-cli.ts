import type {
  PullRequestAction,
  PullRequestMergeMethod,
  PullRequestRef,
  PullRequestSnapshot,
} from "@getpie/contract/pull-request";
import { Data, Effect, Ref, Stream } from "effect";
import type { PlatformError } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

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
import { normalizeGitHubPullRequestJson } from "./normalization";

const COMMAND_TIMEOUT = "30 seconds";
const FORCE_KILL_AFTER = "2 seconds";
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;

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

class GitHubCliTimedOut extends Data.TaggedError("GitHubCliTimedOut") {}
class GitHubCliOutputTooLarge extends Data.TaggedError("GitHubCliOutputTooLarge") {}
class GitHubCliIoError extends Data.TaggedError("GitHubCliIoError")<{
  readonly phase: "spawn" | "stdout" | "stderr" | "exit";
}> {}

class GitHubCliExecutableMissing extends Data.TaggedError("GitHubCliExecutableMissing") {}

type GitHubCliExecutionError =
  | GitHubCliTimedOut
  | GitHubCliOutputTooLarge
  | GitHubCliIoError
  | GitHubCliExecutableMissing;

interface GitHubCliResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

const concatBytes = (chunks: ReadonlyArray<Uint8Array>, length: number): Uint8Array => {
  const output = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
};

const isMissingExecutable = (error: PlatformError.PlatformError): boolean =>
  error.reason._tag === "NotFound" &&
  error.reason.module === "ChildProcess" &&
  error.reason.method === "spawn";

const spawnError = (error: PlatformError.PlatformError): GitHubCliExecutionError =>
  isMissingExecutable(error)
    ? new GitHubCliExecutableMissing()
    : new GitHubCliIoError({ phase: "spawn" });

const streamError =
  (phase: "stdout" | "stderr" | "exit") => (_error: PlatformError.PlatformError) =>
    new GitHubCliIoError({ phase });

const executeGh = (
  spawner: ChildProcessSpawner.ChildProcessSpawner["Service"],
  cwd: string,
  args: ReadonlyArray<string>,
): Effect.Effect<GitHubCliResult, GitHubCliExecutionError> =>
  Effect.scoped(
    Effect.gen(function* () {
      const child = yield* spawner
        .spawn(
          ChildProcess.make("gh", args, {
            cwd,
            env: { GH_PROMPT_DISABLED: "1" },
            extendEnv: true,
            stdin: "ignore",
            forceKillAfter: FORCE_KILL_AFTER,
          }),
        )
        .pipe(Effect.mapError(spawnError));
      const totalBytes = yield* Ref.make(0);
      const stdoutChunks: Uint8Array[] = [];
      const stderrChunks: Uint8Array[] = [];
      let stdoutBytes = 0;
      let stderrBytes = 0;

      const collect = (
        chunks: Uint8Array[],
        phase: "stdout" | "stderr",
      ): Effect.Effect<void, GitHubCliOutputTooLarge | GitHubCliIoError> =>
        Stream.runForEach(child[phase], (chunk) =>
          Effect.gen(function* () {
            const accepted = yield* Ref.modify(totalBytes, (current) => {
              const next = current + chunk.byteLength;
              return next > MAX_OUTPUT_BYTES
                ? ([false, current] as const)
                : ([true, next] as const);
            });
            if (!accepted) return yield* new GitHubCliOutputTooLarge();
            chunks.push(Uint8Array.from(chunk));
            if (phase === "stdout") stdoutBytes += chunk.byteLength;
            else stderrBytes += chunk.byteLength;
          }),
        ).pipe(Effect.catchTag("PlatformError", (error) => Effect.fail(streamError(phase)(error))));

      const results = yield* Effect.all(
        [
          collect(stdoutChunks, "stdout"),
          collect(stderrChunks, "stderr"),
          child.exitCode.pipe(Effect.mapError(streamError("exit"))),
        ],
        { concurrency: "unbounded" },
      );
      const decoder = new TextDecoder();
      return {
        exitCode: Number(results[2]),
        stdout: decoder.decode(concatBytes(stdoutChunks, stdoutBytes)),
        stderr: decoder.decode(concatBytes(stderrChunks, stderrBytes)),
      };
    }),
  ).pipe(
    Effect.timeoutOrElse({
      duration: COMMAND_TIMEOUT,
      orElse: () => Effect.fail(new GitHubCliTimedOut()),
    }),
  );

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

const mapExecutionReadError = (error: GitHubCliExecutionError): PullRequestReadFailure =>
  error._tag === "GitHubCliExecutableMissing"
    ? new PullRequestMissingGh()
    : new PullRequestHostUnavailable();

const mapExecutionActionError = (error: GitHubCliExecutionError): PullRequestCliActionFailure =>
  error._tag === "GitHubCliExecutableMissing"
    ? new PullRequestMissingGh()
    : new PullRequestActionOutcomeUnknown();

export const makeGitHubCliAdapter = (
  spawner: ChildProcessSpawner.ChildProcessSpawner["Service"],
): GitHubCliAdapter => ({
  current: (cwd, pullRequest) =>
    executeGh(spawner, cwd, currentPullRequestArgs(pullRequest)).pipe(
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
    executeGh(spawner, cwd, pullRequestActionArgs(url, action, expectedHeadSha)).pipe(
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
});
