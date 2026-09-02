# Feature map

Source of truth for what a pie web proof must cover. Each file is one user-facing feature. A run that only exercises the easiest entry point is incomplete when the file lists others.

Primary surface: Vite app at `http://localhost:4190/`. After `pie-verify web launch`, drive with **`agent-browser`** (repo shim loads the current run). Steps are in the parent `SKILL.md` Drive section and each feature file below.

| Feature | File | User entry |
| --- | --- | --- |
| Import a local folder as a Project | [import-project.md](import-project.md) | Empty `/draft`, or sidebar **Import project** |
| Start a new chat | [draft-new-chat.md](draft-new-chat.md) | `/` → `/draft`, **New chat**, or per-project compose |
| Talk in a session | [session-chat.md](session-chat.md) | After send, or a sidebar session row. Streaming: Send queues a follow-up; **Steer** submits this draft |
| Find and manage sessions | [sidebar-sessions.md](sidebar-sessions.md) | Left **Projects** list |
| Content panel beside chat | [content-panel.md](content-panel.md) | **Toggle content panel** on a session |

Desktop and the CLI daemon have their own skills (`.cursor/skills/verify-pie-desktop`, `.cursor/skills/verify-pie-cli`). Placeholder Terminal/Browser *behavior* (mock chrome) stays noted in the files, not separate features.

When routes, copy, or selectors change, edit the matching file. Use `/maintain-verification-skill` to keep this map honest.
