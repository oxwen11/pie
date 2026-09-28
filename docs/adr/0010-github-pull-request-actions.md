# GitHub CLI owns host access; GitHub authorizes PR mutations

Use the user's authenticated `gh` installation rather than storing another
GitHub credential or introducing a provider registry. Session operations carry
SessionRef; the RPC boundary resolves the actual workspace before calling the
private GitHub adapter.

## Decision

- Launch finite `gh` commands with executable/argv, scoped process ownership,
  timeouts, bounded output, and conservative error mapping. Do not expose raw
  command output, credentials, or process handles through the RPC seam.
- Resolve and retain stable PR identity before mutations. For merge and
  enable-auto-merge, send `--match-head-commit <expected-sha>` so GitHub checks
  the head atomically. A local read-then-write check is not race protection.
  Missing host capability must fail closed, not weaken this precondition.
- GitHub remains authoritative for permissions, branch protection, required
  checks/reviews, rulesets, and merge queues. UI action hints are not authority.
- Return an acknowledgement once the write is accepted. Client query refresh
  happens separately; a failed refresh cannot turn an applied merge into a
  failed mutation or trigger an automatic retry.
- A timeout or local I/O failure after an attempted mutation can mean
  `OUTCOME_UNKNOWN`. Tell the caller to inspect GitHub; do not assert rejection
  without a confirmed host result.
- Share the generated query cache across header, panel, and other consumers.
  Do not introduce a second server snapshot cache or refresh RPC merely to
  duplicate query invalidation.

## Verification boundary

Command-construction tests prove only Pie's side of the seam. Real GitHub
acceptance must cover competing pushes, an applied action followed by a failed
refresh, session/worktree isolation, and host authentication/policy failures.
A mock cannot establish that GitHub honored the head precondition.

The original implementation plan has been replaced by this decision and the
current code under [`pull-request/`](../../packages/server/src/pull-request/).
The remaining [oversized-diff fallback](../rfc/pr-diff-oversized-files.md)
is a separate proposal, not permission to silently return a complete-looking patch.
