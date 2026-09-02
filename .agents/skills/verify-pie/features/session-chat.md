# Session chat

`/session/<sessionId>` is transcript + composer. No extra header bar on the route itself — the shell card heading is the session title. The loader runs `agent.session.prepare` (validates the ref, backfills cwd, does **not** start Pi). A missing session toasts and redirects to `/draft`.

## Sub-features

- **Open from a URL** with `?projectId=` (fast path) or bare `/session/<id>` (`session.resolveRef` then prepare).
- **Transcript** — user bubbles (right, primary), assistant + tool/reasoning. Empty settled history renders nothing; loading shows **Loading earlier messages…**; failed history shows **Earlier messages couldn't be loaded...**.
- **Composer** — same TipTap stack as draft, no draft placeholder. Submit keymap is Enter; **click Send message**. Footer shows the current git branch, **Not a Git repository**, or **Workspace unavailable**.
- **Streaming toolbar** — while `status === "streaming"`, three controls: **Steer message**, **Stop generating**, **Send message**. Stop only aborts the current run.
- **Follow-up** — Send / Enter while a turn is running queues `delivery: "followUp"`. The draft clears. It is **not** a transcript bubble and the composer does **not** list it.
- **Steer** — **Steer message** submits the **current draft** as `delivery: "steer"` (inject before the next LLM call). One shot, not a mode: the next Send stays follow-up. The composer does **not** list the steered text.
- **Model select** — live session toolbar; same combobox as draft.
- **In-flight** — **Thinking…** / **working…** status after submit, before tokens.

## How to get to it (user POV)

- Send from `/draft` (lands here with the user bubble already present).
- Click a session row in the sidebar.
- Revisit a bookmarked `/session/<uuid>` (optionally `?projectId=`).

## Driving it with agent-browser

```bash
# after a draft send, or:
agent-browser open "http://localhost:4190/session/<sessionId>?projectId=<projectId>"
agent-browser wait --url "**/session/**"
```

Follow-up prompt (idle session — Pi finished or failed):

1. Snapshot: heading is the first-prompt title; supporting text is the project name; composer at the bottom.
2. Click the contenteditable. Type a second distinctive line.
3. Click **Send message** (not Enter).
4. User bubble appears. **Thinking…** may follow.

Queue + Steer (only when a turn is actually streaming — hold-open fake Pi, or a long real turn):

1. Snapshot: **Steer message**, **Stop generating**, and **Send message** are all present. Steer and Send are disabled while the draft is empty. The composer has no queue list / Steer labels above the input.
2. Type a distinctive follow-up. Click **Send message** (not Steer). The draft clears. The user bubble must **not** gain that text. The composer still has no queued-text header.
3. Type a distinctive steer line. Click **Steer message**. The draft clears. Steer is not pressed / not a toggle. Still no list on the composer.
4. Type another line and click **Send message** again. Draft clears again. Proof is the child log, not the input.

Proof:

- URL still `/session/<same-id>?projectId=<same-id>`.
- Both user texts are in the transcript snapshot (idle follow-up), or only the first prompt is a bubble (queued path).
- Session JSON under `$PIE_HOME/storage/sessions/<projectId>/<sessionId>.json` still exists (title may stay the first prompt unless renamed).
- If Pi runs: assistant text or tool cards. If not: **Model request failed** / **Model usage limit reached** — that is the isolated-home default, not a navigation bug.
- Queued path: fake-pi / child log shows `follow_up` then `steer` (not two `steer`s). The composer does not list either line.

Stop (only when a turn is actually streaming): click **Stop generating**; Steer / Stop disappear and Send remains **Send message**. The composer still has no queue list.

## Gotchas

- `prepare` starts nothing. A quiet transcript on first paint is normal until history loads or you send.
- Opening a session does not attach a Pi child until a prompt or history read needs one.
- `agentSessionId` in the JSON is Pi's native id after the agent has opened — do not require it to prove create.
- Content panel toggle is session-only; it is not a failure if it is absent on `/draft`.
- Do not use 4180 as the page origin. The session route will load a stale/missing shell.
