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

**Video** — one recording that covers the whole drive, from the first
interaction to the state you claim as proof. Start it before the first click,
stop it after the last assertion. Save it in the evidence directory next to the
screenshots.

```bash
EVIDENCE="$(pnpm exec pie-verify web evidence path)"
agent-browser record start "$EVIDENCE/<feature>.webm"   # from the current page
# …drive…
agent-browser record stop
```

`record start` opens a fresh browser context on the current URL (cookies and
localStorage carry over), so `open` the page and settle it first, then start
recording, then act. Use `record restart <path>` to split a long drive into
several clips. Desktop drives through CDP (`pie-verify desktop`); if
`record start` refuses on that attached session, capture the run's display
instead (`ffmpeg -f x11grab -i "$DISPLAY" …` on the Xvfb the launcher started)
and note the fallback with `evidence note`.

Then write down what the clip shows:

```bash
pnpm exec pie-verify web evidence note "<feature>.webm: import → dialog → Import this folder → sidebar row"
```

Replace `web` with `desktop` for the Electron surface. `pie-verify cli` has no
browser and no UI evidence requirement.

## Where evidence lives and where it goes

- Evidence directory: `.agents/skills/verify-pie{,-desktop}/evidence/<run-id>/`
  (`pnpm exec pie-verify web|desktop evidence path`). It survives `cleanup` and is
  gitignored — never commit screenshots or videos.
- A UI PR, issue, or comment must carry the image(s) **and** the video:
  `gh pr|issue create|edit|comment --attach <png> --attach <webm>`.
- Name files after the feature you proved (`import-project-before.png`,
  `import-project-after.png`, `import-project.webm`), not `screen.png`.

## Non-negotiables

- No screenshots of a mocked or hand-seeded state — drive the real user path
  (see the Evidence standards in each `verify-pie*` skill).
- Do not swap the video for a snapshot series or a description of what happened.
- A green Playwright e2e run (`apps/desktop/e2e/`, test mode) does not replace
  this evidence for a UI change.
