# Verify evidence

Every runtime verification (`pnpm exec pie-verify web|cli|desktop …`, or any
manual drive of the app) ends with **evidence**, not a sentence. What counts as
evidence depends on whether the change is UI-related.

## UI-related means

Any of these makes the verification UI-related — when in doubt, it is:

- the diff touches `apps/app/**`, `packages/ui/**`, or the Electron window
  chrome in `apps/desktop/**` (splash, overlay, dialogs, renderer bridge);
- routes, copy, selectors, or handles listed in a `verify-pie*/features/*.md`
  file change;
- the issue or bug is about something a user sees (layout, state, flicker,
  focus, streaming display, a button that does not respond).

Server, contract, CLI daemon, storage, and lint/tooling changes are not
UI-related. Their evidence is logs, `curl`, and `evidence side-effects`.

## UI-related verifications MUST ship screenshots AND a video

Both are mandatory. One without the other is an incomplete proof — report it
as incomplete instead of calling the verification passed.

**Screenshots** — at least one **before** the action and one **after** the
resulting state, for every user path the feature file lists. Capture the
action and the state it produced, not only the final frame.

```bash
pnpm exec pie-verify web evidence screenshot <feature>-before
# …drive…
pnpm exec pie-verify web evidence screenshot <feature>-after
```

**Video** — the Verify `agent-browser` shim automatically records the complete
drive at 60 fps. The first browser command starts
`evidence/<run-id>/recording-001.webm` on the current page; later commands retain
the same take. Start each additional validation with `evidence init`: it stops
the current take and advances to `recording-002.webm`, `recording-003.webm`, and
so on. Do not call `record start`, `restart`, or `stop`. Normal Verify cleanup
stops and flushes the current recording before removing the run.

Write down what each automatic clip shows:

```bash
pnpm exec pie-verify web evidence note "recording-001.webm: import → dialog → Import this folder → sidebar row"
```

Replace `web` with `desktop` for the Electron surface. `pie-verify cli` has no
browser and no UI evidence requirement.

## Where evidence lives and where it goes

- Evidence directory: `.agents/skills/verify-pie{,-desktop}/evidence/<run-id>/`
  (`pnpm exec pie-verify web|desktop evidence path`). It survives `cleanup` and is
  gitignored — never commit screenshots or videos.
- A UI PR, issue, or comment must carry the image(s) **and** the video:
  `gh pr|issue create|edit|comment --attach <png> --attach <webm>`.
- Name screenshots after the feature you proved (`import-project-before.png`,
  `import-project-after.png`), not `screen.png`. The automatic video is always
  numbered `recording-<NNN>.webm` files.

## Non-negotiables

- No screenshots of mocked or manually edited state. Verify's default run-local
  sample Project is approved setup for features other than Import project. For
  Import project, launch with `--replace --empty-projects` and drive the real
  import path (see the Evidence standards in each `verify-pie*` skill).
- Do not swap the video for a snapshot series or a description of what happened.
- A green Playwright e2e run (`apps/desktop/e2e/`, test mode) does not replace
  this evidence for a UI change.
