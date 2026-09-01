# Session chat

`/session/<sessionId>` is transcript + composer. No extra header bar on the route itself — the shell card heading is the session title. The loader runs `agent.session.prepare` (validates the ref, backfills cwd, does **not** start Pi). A missing session toasts and redirects to `/draft`.

## Sub-features

- **Open from a URL** with `?projectId=` (fast path) or bare `/session/<id>` (`session.resolveRef` then prepare).
- **Transcript** — user bubbles (right, primary), assistant + tool/reasoning. Empty settled history renders nothing; loading shows **Loading earlier messages…**; failed history shows **Earlier messages couldn't be loaded...**.
- **Composer** — same TipTap stack as draft, no draft placeholder. Submit keymap is Enter; **click Send message**. Footer shows the current git branch, **Not a Git repository**, or **Workspace unavailable**.
- **Stop** — while `status === "streaming"`, the same button is **Stop generating**.
- **Model select** — live session toolbar; same combobox as draft.
- **In-flight** — **Thinking…** status after submit, before tokens.

## How to get to it (user POV)

- Send from `/draft` (lands here with the user bubble already present).
- Click a session row in the sidebar.
- Revisit a bookmarked `/session/<uuid>` (optionally `?projectId=`).

## Driving it with agent-browser

```bash
# after a draft send, or:
agent-browser open 'http://127.0.0.1:4190/session/<sessionId>?projectId=<projectId>'
agent-browser snapshot
```

Follow-up prompt:

1. Snapshot: heading is the first-prompt title; supporting text is the project name; composer at the bottom.
2. Click the contenteditable. Type a second distinctive line.
3. Click **Send message** (not Enter).
4. User bubble appears. **Thinking…** may follow.

Proof:

- URL still `/session/<same-id>?projectId=<same-id>`.
- Both user texts are in the transcript snapshot.
- Session JSON under `$PIE_HOME/storage/sessions/<projectId>/<sessionId>.json` still exists (title may stay the first prompt unless renamed).
- If Pi runs: assistant text or tool cards. If not: **Model request failed** / **Model usage limit reached** — that is the isolated-home default, not a navigation bug.

Stop (only when a turn is actually streaming): click **Stop generating**; button returns to **Send message**.

## Gotchas

- `prepare` starts nothing. A quiet transcript on first paint is normal until history loads or you send.
- Opening a session does not attach a Pi child until a prompt or history read needs one.
- `agentSessionId` in the JSON is Pi's native id after the agent has opened — do not require it to prove create.
- Content panel toggle is session-only; it is not a failure if it is absent on `/draft`.
- Do not use 4180 as the page origin. The session route will load a stale/missing shell.
