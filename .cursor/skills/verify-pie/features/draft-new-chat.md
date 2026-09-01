# Draft / new chat

The new-session surface. `/` has no UI — it redirects to `/draft`. A send creates a Session under the selected Project, fires the first prompt, and navigates to `/session/<sessionId>?projectId=<projectId>`.

## Sub-features

- **Centered composer** after at least one Project exists: project picker, optional git workspace/worktree controls, model select, TipTap input, submit.
- **Project picker** — no implicit default. Placeholder **Select a project**. Send stays disabled until a project is chosen. Changing it writes `?projectId=` (replace).
- **Workspace mode** (git repos only): **Current directory** vs **New worktree**. Worktree requires a **base branch** (`aria-label="Base branch for worktree"`). Non-git shows **Not a Git repository**. Missing folder shows **Workspace unavailable** and blocks send.
- **Model select** — options from Pi `get_available_models`, grouped by provider, trigger shows the model name or **Default**. Hidden when the model list is empty (`models.length === 0`). Default model is written into `?provider=&modelId=` once.
- **Send** — creates the session (cwd persisted, worktree materialized if requested), then `prompt(text)` without waiting for Pi to spawn, then navigates.

## How to get to it (user POV)

- Visit `/` or `/draft`.
- Sidebar **New chat** (clears to a fresh draft).
- Per-project compose: **New chat in \<name\>** (sr-only on the folder's pen). Lands on `/draft?projectId=<that project>`.

## Driving it with agent-browser

Prerequisite: a Project (see [import-project.md](import-project.md)). Isolated launch + import of `verify-pie-sample` is enough. That sample is **not** a git repo, so you should see **Not a Git repository** and no worktree picker.

```bash
agent-browser open 'http://localhost:4190/draft'
agent-browser snapshot
```

1. Confirm card heading **New chat** and the project name as supporting text once a project is selected.
2. If the trigger still says **Select a project**, open it and choose **verify-pie-sample**.
3. Click the contenteditable (placeholder **Ask Pi anything...**). `keyboard type` a distinctive prompt, e.g. `verify-pie ping`.
4. Snapshot: submit is now enabled. **Click it** — do not press Enter.
5. Wait for the URL to become `/session/<uuid>?projectId=<uuid>`.

Proof:

- User bubble shows the exact prompt text.
- Sidebar lists a session titled with that prompt under the project.
- `$PIE_HOME/storage/sessions/<projectId>/<sessionId>.json` exists; `cwd` is the project path; `title` is the prompt. `verify-pie evidence side-effects`.
- Assistant streaming is **optional**. Without `pi` or provider keys, a **Model request failed** card is still a successful create.

Worktree path (only if the imported folder is a git repo): switch the workspace select to **New worktree**, pick a base branch, send. Create must fail closed on git errors (no session file). Success writes `cwd` under `$PIE_HOME/worktrees/<repo>/<key>/`.

## Gotchas

- CDP Enter does **not** submit. Click the arrow button. Draft submit has **no aria-label** — identify it as the composer submit after the field is non-empty.
- Send is disabled when: input empty, no project, workspace unavailable, create in flight, or worktree mode with no base branch.
- Toast **Pick a project before sending.** if you submit without a project (keyboard map can still fire).
- Model select missing ≠ broken draft. Pi unavailable ⇒ empty list ⇒ component returns `null`.
- After adding/renaming routes, load `/` through Vite before typechecking (`routeTree.gen.ts` is plugin-generated).
