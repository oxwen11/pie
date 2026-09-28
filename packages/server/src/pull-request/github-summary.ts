import {
  pullRequestKey,
  type PullRequestLifecycle,
  type PullRequestRef,
  type PullRequestSummary,
} from "@getpie/contract/pull-request";
import { Schema } from "effect";

import { parsePullRequestRef } from "./normalization";

export const SUMMARY_PULL_REQUEST_FIELDS = [
  "number",
  "url",
  "title",
  "state",
  "isDraft",
  "headRefName",
  "baseRefName",
] as const;

const SummaryJson = Schema.Struct({
  number: Schema.Int.check(Schema.isGreaterThan(0)),
  url: Schema.String,
  title: Schema.String,
  state: Schema.Literals(["OPEN", "CLOSED", "MERGED"]),
  isDraft: Schema.Boolean,
  headRefName: Schema.String,
  baseRefName: Schema.String,
});

const summaryLifecycle = (
  state: "OPEN" | "CLOSED" | "MERGED",
  draft: boolean,
): PullRequestLifecycle =>
  state === "OPEN" ? { type: "open", draft } : { type: state === "MERGED" ? "merged" : "closed" };

export const decodeSummary = (
  raw: unknown,
  checkedAt: string,
  expected?: PullRequestRef,
): PullRequestSummary => {
  const value = Schema.decodeUnknownSync(SummaryJson)(raw);
  const ref = parsePullRequestRef(value.url, value.number);
  if (expected && pullRequestKey(ref) !== pullRequestKey(expected))
    throw new Error("Unexpected pull request identity");
  return {
    ref,
    title: value.title,
    headBranch: value.headRefName,
    baseBranch: value.baseRefName,
    lifecycle: summaryLifecycle(value.state, value.isDraft),
    checkedAt,
  };
};

const DiscoveryJson = Schema.Array(
  Schema.Struct({
    ...SummaryJson.fields,
    headRepository: Schema.NullOr(Schema.Struct({ nameWithOwner: Schema.String })),
    headRepositoryOwner: Schema.NullOr(Schema.Struct({ login: Schema.String })),
  }),
).check(Schema.isMaxLength(2));

export const decodeDiscovery = (
  raw: unknown,
  branch: string,
  repo: RepositoryContext,
  checkedAt: string,
): PullRequestSummary | null => {
  const values = Schema.decodeUnknownSync(DiscoveryJson)(raw);
  // A capped result is ambiguous even if filtering would leave one entry.
  if (values.length > 1) throw new Error("Ambiguous pull request head");
  const value = values[0];
  if (!value) return null;
  const summary = decodeSummary(value, checkedAt);
  if (
    summary.headBranch !== branch ||
    summary.ref.host.toLowerCase() !== repo.host.toLowerCase() ||
    `${summary.ref.owner}/${summary.ref.repository}`.toLowerCase() !==
      `${repo.owner}/${repo.repository}`.toLowerCase() ||
    value.headRepository?.nameWithOwner.toLowerCase() !==
      `${repo.owner}/${repo.repository}`.toLowerCase() ||
    value.headRepositoryOwner?.login.toLowerCase() !== repo.owner.toLowerCase()
  ) {
    throw new Error("Pull request source does not match recorded branch repository");
  }
  return summary;
};

export interface RepositoryContext {
  readonly host: string;
  readonly owner: string;
  readonly repository: string;
}

export const repositoryFromBranchConfig = (raw: string, branch: string): RepositoryContext => {
  if (
    !branch ||
    branch.startsWith("-") ||
    /[\s~^:?*[\\]/.test(branch) ||
    Array.from(branch).some((character) => character.charCodeAt(0) < 32) ||
    branch.includes("..")
  )
    throw new Error("Invalid branch");
  const config = raw
    .split("\0")
    .filter(Boolean)
    .map((entry) => {
      const separator = entry.indexOf("\n");
      if (separator < 1) throw new Error("Invalid git config response");
      return [entry.slice(0, separator), entry.slice(separator + 1)] as const;
    });
  const remotes = config.filter(([key]) => /^remote\..+\.url$/.test(key));
  const tracking = config.filter(([key]) => key === `branch.${branch}.remote`);
  const merges = config.filter(([key]) => key === `branch.${branch}.merge`);
  if (
    tracking.length > 1 ||
    merges.length > 1 ||
    (merges[0] && merges[0][1] !== `refs/heads/${branch}`)
  )
    throw new Error("Ambiguous branch tracking");
  const selected = tracking[0]
    ? remotes.filter(([key]) => key === `remote.${tracking[0]?.[1]}.url`)
    : remotes;
  const rawUrl = selected[0]?.[1];
  if (selected.length !== 1 || rawUrl === undefined) throw new Error("Ambiguous repository remote");
  const scp = /^git@([^:]+):([^/]+)\/(.+)$/.exec(rawUrl);
  const url = new URL(scp ? `ssh://git@${scp[1]}/${scp[2]}/${scp[3]}` : rawUrl);
  if (
    !["https:", "ssh:"].includes(url.protocol) ||
    url.password ||
    url.port ||
    url.search ||
    url.hash ||
    (url.username && url.username !== "git")
  )
    throw new Error("Unsupported repository URL");
  const parts = url.pathname
    .replace(/\.git$/, "")
    .split("/")
    .filter(Boolean);
  const owner = parts[0];
  const repository = parts[1];
  if (
    parts.length !== 2 ||
    !owner ||
    !repository ||
    !parts.every((part) => /^[A-Za-z0-9._-]+$/.test(part))
  )
    throw new Error("Unsupported repository path");
  return { host: url.hostname, owner, repository };
};
