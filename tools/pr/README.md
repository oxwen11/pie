# PR review tools

Operator scripts for the mechanical steps in
[pull-requests.md](../../.agents/rules/workflows/pull-requests.md).
Not `pie-verify`: that tool already owns isolated launch, doctor, evidence,
cleanup, and daemon-token redaction.

| Script                     | What it does                                                              |
| -------------------------- | ------------------------------------------------------------------------- |
| `tools/pr/pr-status`       | Head and base SHAs, required checks, `MERGEABLE`, commits behind the base |
| `tools/pr/pr-sync`         | `update-branch` with `expected_head_sha`                                  |
| `tools/pr/pr-worktree`     | Detached worktree pinned to the reviewed head                             |
| `tools/pr/pr-merge`        | Squash-merge that SHA; stacked pull requests use `merge-async`            |
| `tools/pr/pr-session`      | Sessions whose stored pull request number matches                         |
| `tools/pr/redact-evidence` | Crop or blur a public screenshot or video                                 |

Each script accepts `--help`. They use the `gh` already authenticated on this
machine and do not print tokens. `pr-merge` does not pass `--admin`, `--auto`,
or `bypass_rules`. An unverified merge or sync exits 2. `redact-evidence` writes
`*.redacted.*` next to the original; attach only those files, not a glob.

Requirements: `gh` and `jq` (1.6+). `pr-worktree` also needs `git`.
`redact-evidence` also needs `magick` for images and `ffmpeg` for video.

```bash
bash tools/pr/test.sh
```
