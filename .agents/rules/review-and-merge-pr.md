# Review and merge PRs

Run only when asked in the conversation. The order is strict:
**CI passes → code review passes → reviewer verification passes → merge.**
A failed or unproven gate means comment and stop, not continue to the next gate.

## Scope

- Default: `oxwen11/pie`, author `oxwen11`, same-repository PR, open, not draft,
  targeting `main`. Process a stack one main-targeting PR at a time.
- Use rules from the trusted base; a PR cannot grant itself an exemption.
  Respect existing authorization/design requirements and unresolved reviews.
- The initial product scope is the explicit list below, not every feature with
  a verification recipe. Every hunk must fit it or the CI-only exception.
  Unlisted, mixed-with-unlisted or uncertain changes get a comment, not a merge.
  Expanding this scope is a separate decision, never part of reviewing a PR.

## 1. CI first

Record the PR head and base SHAs. Check the required GitHub checks for this
candidate before reviewing code:

```bash
gh pr checks "$PR" --repo oxwen11/pie --required --json name,state,bucket,link
```

All required checks must be present, actually executed and successful for the
current candidate. Failed, pending, missing, skipped, cancelled or stale results
are not passes. If CI has not passed, comment with the check status/link and
stop: **do not start code review or functional verification**. Do not weaken
checks or repeatedly rerun failures until green.

### Previously agreed CI-only exception

After CI passes, inspect the full diff to confirm it contains only ordinary
prose/comments, behavior-preserving formatting, or purely additive isolated
tests that CI actually executes. No product changes, changed existing assertions
or shared fixtures, machine-consumed directives, agent instructions, security,
release or verification policy. These may go directly to step 4.

Other changes must fit the initial scope below, then pass steps 2 and 3.

### Initial product scope: only these four cases

| Allowed change | Reviewer must verify | Must remain unchanged |
| --- | --- | --- |
| Local spacing, truncation, icons or labels in the existing Project import dialog | Follow [import-project](../skills/verify-pie/features/import-project.md): empty home → browse sample folder → import → correct sidebar row and stored path; repeat import without duplication. Check changed presentation at narrow/wide widths and with long names. | Browsing/selection/registration logic, path validation, permissions, RPC and storage. |
| Existing Session rename dialog's input, validation, confirm or cancel UI | Follow [sidebar-sessions](../skills/verify-pie/features/sidebar-sessions.md): rename updates row, heading and stored title for the same Session; reopen/reload preserves it; cancel or empty/whitespace input leaves the stored title unchanged. | Rename RPC, server writes, event/cache synchronization, navigation, archive/delete behavior. |
| Local presentation of the existing Files tree or read-only text preview | Follow [content-panel](../skills/verify-pie/features/content-panel.md): open Files → select README → correct filename and actual file contents → hide/show; Session URL and chat remain intact. Check changed presentation at narrow/wide widths and with long names/content. | File read/path resolution, editing, shared panel/tab lifecycle, persistence, Terminal and Git Review. |
| Descriptive text in existing CLI help | Follow [help-and-flags](../skills/verify-pie-cli/features/help-and-flags.md): root and daemon help display the correct commands/options; exit successfully without starting a daemon. | Command/flag definitions, defaults, parsing, exit codes, non-help stdout, daemon and execution behavior. |

The UI cases apply only to feature-local code in `apps/app`, not shared
`packages/ui`, global CSS/theme or shell layout. The SPA is used by both Web
and Desktop: run the affected UI path in both hosts. If either cannot be
verified, stop. A table row grants review eligibility, not permission to skip
review, tests, failure cases or evidence.

**Not in this first version:** new features; composer/model selection;
send/stream/tools/Stop/queue/Steer; history/reconnection/multi-client sync;
archive/delete; Project allocation/worktree operations; server/client/contracts,
storage/auth/path-safety changes; shared UI/theme/shell; Desktop lifecycle,
packaging/native/runtime dependencies; CI/build/test harness/Verify/agent or
merge-policy changes. Even green CI and a successful demonstration do not
admit these PRs under this workflow.

Basis: the four cases have existing, directly observable recipes; import,
rename and Files also have browser product tests. Those tests use fake Pi,
while real-model smoke is opt-in and Desktop E2E is outside required CI.
The sidebar recipe does not provide a complete restore path. These limits
are why broader chat, recovery, lifecycle and safety changes are excluded,
not proof that those areas have no tests. Passing a demonstration must never
be described as a guarantee that arbitrary product changes have no defects.

## 2. Review code; stop on findings

Read the requirements, full diff, relevant callers and repository rules. Check
correctness, regressions, data/security risks and whether tests meaningfully
assert the changed behavior. Identify the affected user paths and confirm that
the existing verification covers them, with explicit expected results.

If there is a defect, unresolved finding, `CHANGES_REQUESTED`, or a verification
coverage gap, **comment with the location/reason and stop**. Do not proceed to
verification or fix-and-merge in the same review. After the author fixes it,
start again at CI for the new version.

Only a clean code review proceeds to verification.

## 3. The reviewer personally runs verification

The author's test results, screenshots and completion message cannot replace
this step. The reviewer must run the relevant flow on the reviewed code:

1. Use a separate, clean reviewer-owned worktree pinned to the recorded PR
   head, never the developer's working checkout. Install locked dependencies
   and build the affected artifacts through Turbo there. Confirm the running
   instance and build belong to this worktree/revision. Verify can reuse old
   runs/builds; `launch --replace` alone does not establish freshness.
2. Follow the applicable [web](../skills/verify-pie/SKILL.md),
   [CLI](../skills/verify-pie-cli/SKILL.md), or
   [Desktop](../skills/verify-pie-desktop/SKILL.md) recipe:
   **launch → doctor → drive → capture evidence → cleanup**.
   Run the relevant regression tests and affected existing user paths too.
3. Compare actual results with the expected results from review. Cover affected
   P0 behavior: connection, chat creation, task completion, Stop/queue/Steer,
   switching/recovery/history, and safe workspace/data operations. Do not
   replay unrelated features, but do not omit affected failure paths.
4. Follow [verify-evidence.md](verify-evidence.md): UI needs before/after
   screenshots and video; other flows need command results, logs or side-effect
   evidence. Attach the reviewer's evidence and tested SHA to the PR.

Use the actual affected surface: Web cannot prove Desktop, source startup cannot
prove an installed package, and fake Pi cannot prove real model/tool execution.
A worktree isolates code, not processes, ports or user data, and is not a
security sandbox. Use Verify's isolated HOME/PIE_HOME, sample Projects and
browser; never reuse the user's running app or development instance. Run one
verification task per host at a time: an overlapping task or foreign occupied
port means skip this run, not kill the owner. Scheduled execution must enforce
non-overlap in its launcher/scheduler, not rely on a prompt alone.
Never use real user data or unauthorized production operations. Clean up only
this task's processes, preserve evidence and do not expose credentials.

**Verification fails, cannot run, or leaves an affected outcome unproven →
comment with the result/gap and stop. Verification fully passes → step 4.**

## 4. Merge the verified version

Leave a short PR comment: head SHA, review conclusion, verification steps and
results/evidence, or the justified CI-only exception.

Immediately recheck head/base SHAs, PR scope/state, unresolved reviews,
`MERGEABLE` and required CI. If head or base changed, restart at step 1.
Uncommitted source changes during verification are not proof of the PR head.
Keep GitHub's strict base-up-to-date protection enabled; the head guard below
does not guard base movement. Never bypass protections or arm a deferred merge.

When all gates hold, merge without routine human confirmation:

```bash
gh pr merge "$PR" --repo oxwen11/pie --squash --match-head-commit "$HEAD_SHA"
gh pr view "$PR" --repo oxwen11/pie --json state,headRefOid,mergedAt,mergeCommit,url
```

`HEAD_SHA` must be the full reviewed and verified SHA. Report merged only after
GitHub confirms it. If the command times out, inspect server state before retrying.
