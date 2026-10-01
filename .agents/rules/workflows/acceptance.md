# Acceptance

## Match checks to the change

- Verify the agreed behavior and each identified high-cost risk. Cover existing
  clients/data, compatibility, migration, interruption/retry, and recovery where
  relevant, rather than only a fresh-install happy path.
- Verify affected [security boundaries](../topics/security.md), including denial and failure
  behavior. Unresolved security defects block acceptance regardless of correction cost.
- Use focused checks and the appropriate test/runtime surface; do not invent a
  speculative suite. Follow [toolchain.md](../topics/toolchain.md) for test commands.
- Report what ran, observed results, evidence, and gaps. Unverified required
  criteria remain incomplete; tests and live runtime proof are not interchangeable.

## Runtime verification

Use the matching [Web](../../skills/verify-pie/SKILL.md),
[CLI](../../skills/verify-pie-cli/SKILL.md), or
[Desktop](../../skills/verify-pie-desktop/SKILL.md) recipe:
launch → doctor → drive → capture evidence → cleanup.
The [web dev recipe](../../skills/verify/SKILL.md) covers the two-process local setup.

## Required proof

- Every runtime verification ends with observed results and evidence, not just
  a completion claim. Missing proof is incomplete, not passed.
- UI-related means changes in `apps/app`, `packages/ui`, Electron window chrome,
  recipe routes/copy/selectors/handles, or bugs in visible behavior. When unsure,
  treat it as UI-related.
- UI proof requires **before and after screenshots plus video** for the user
  paths listed in the relevant feature recipe. Capture the action and resulting
  state, not only a final frame. Tests, snapshots, or prose do not replace either.
- Non-UI server, contract, CLI, storage, and tooling proof uses command results,
  logs, or `evidence side-effects`. CLI verification has no browser requirement.
- Do not present mocked or manually edited state as runtime proof. Verify's
  run-local sample Project is approved except for Import project: launch with
  `--replace --empty-projects` and drive the real import flow.

## Capture and delivery

- Screenshots: `pnpm exec pie-verify web evidence screenshot <name>`; use
  `desktop` for Electron. Names should identify the behavior and before/after state.
- The Verify shim automatically starts and retains a 60 fps browser recording.
  Start each additional validation with `evidence init` to rotate clips. Do not
  call `record start`, `restart`, or `stop`; normal cleanup flushes the video.
- Use `evidence note` to describe what each `recording-<NNN>.webm` demonstrates.
  `evidence path` locates the retained `.agents/skills/verify-pie{,-desktop}/evidence/<run-id>/` directory.
- Attach screenshots **and** video to the UI issue, PR, or comment with
  `gh pr|issue create|edit|comment --attach <png> --attach <webm>`.
  Evidence is gitignored: never commit it or expose credentials in uploads.
