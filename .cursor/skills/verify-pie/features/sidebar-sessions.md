# Sidebar sessions

The left **Projects** list is how a user finds chats. Each imported project is a collapsible group. Sessions are newest-first. The shell treats the session-route loader ref as the single source for the active row, card heading, and content panel.

## Sub-features

- **New chat** — top of the sidebar; navigates to `/draft` (no project hint).
- **Projects group** — label **Projects**, collapse chevron, **Import project** action.
- **Per-project group** — folder name (`title` = full path), **New chat in \<name\>** pen, session rows.
- **Open session** — row label is `session.title ?? "New chat"`. Status dots: **A turn is running in this session**, **Waiting for your action**, **Session crashed**.
- **Actions menu** — **Actions for \<title\>** (ellipsis, show-on-hover). **Rename** and **Archive** / **Restore**. Archive of the open session returns to `/draft?projectId=`.
- **Rename dialog** — field placeholder **New chat**; saves a trimmed non-empty title (card heading and row update from `session.renamed`).

## How to get to it (user POV)

Always visible on `/draft` and `/session/*` (web inset sidebar). On a narrow viewport the sidebar is an overlay; open it with the shell's sidebar trigger before driving rows.

## Driving it with agent-browser

Need at least one Project and one Session (import + draft send).

```bash
agent-browser snapshot
```

1. **New chat** → URL `/draft`, heading **New chat**.
2. **New chat in verify-pie-sample** → `/draft?projectId=<id>`, picker already on that project.
3. Click the session row titled with the prompt you sent → `/session/<id>?projectId=<id>`, that row is active.
4. Open **Actions for \<title\>** → **Rename**. Type a new title, confirm. Heading and row must match. `$PIE_HOME/storage/sessions/<projectId>/<sessionId>.json` `title` matches.
5. Actions → **Archive**. Active session: you land on `/draft?projectId=`. The row disappears from the default (non-archived) list. The JSON has `"archived": true`.

Proof: URL + snapshot after each navigation, plus `verify-pie evidence side-effects` after rename/archive. Do not prove rename by writing the JSON yourself.

## Gotchas

- Several **New chat** controls exist. The sidebar item is global; the per-project pen is scoped (`New chat in <name>`). Snapshot names distinguish them.
- The actions trigger is `showOnHover` — it may be missing from a snapshot until the row is focused or hovered. Click the row first, then look for **Actions for …**.
- There is no archived-list UI in the sidebar today. Restore is only reachable if you can open an archived session's menu; treat archive's side effect on disk + disappearance from the list as the proof.
- Session list cache is also fed by server events (`useSessionListSync`) so a second tab would converge — this skill drives one browser.
