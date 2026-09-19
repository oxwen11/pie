# Draft / new chat

The new-session surface. `/` has no UI — it redirects to `/draft`. A send creates a Session under the selected Project (or allocates a new folder and Project when **Choose project** is selected), fires the first prompt, and navigates to `/session/<sessionId>?projectId=<projectId>`.

## Sub-features

- **Centered composer** always: project picker, optional git workspace/worktree controls, model select, TipTap input, submit. Zero projects is not an empty state — the picker stays on **Choose project**. Import remains on the sidebar.
- **Project picker** — default **Choose project** (no `?projectId=`). The folder icon is part of the trigger. Choosing a project writes `?projectId=` (replace). Hovering the picker shows **X** in place of the folder icon; click **X** clears `?projectId=` back to Choose project without opening the list. Opening the list shows projects, then a **Don't work in a project** button (same clear).
- **Choose project send** — `project.allocate` creates `<root>/<YYYY-MM-DD>/Chat-1/` (then `Chat-2`, …), registers it as a Project with `type: "chat"`, then `session.create`. Sidebar **Recent** lists the session (title is the prompt). **Projects** does not show the chat leaf. The picker still lists imported folders only.
- **Workspace mode** (git repos only, after a real Project is selected): **Current directory** vs **New worktree**. Worktree requires a **base branch** (`aria-label="Base branch for worktree"`). Non-git shows **Not a Git repository**. Missing folder shows **Workspace unavailable** and blocks send.
- **Model select** — options from Pi `get_available_models`, grouped by provider, trigger shows the model name or **Default**. Hidden when the model list is empty (`models.length === 0`). Default model is written into `?provider=&modelId=` once.
- **Send** — creates the session (cwd persisted, worktree materialized if requested), then `prompt(text)` without waiting for Pi to spawn, then navigates. Enabled with content even when no project is selected.

## How to get to it (user POV)

- Visit `/` or `/draft`.
- Sidebar **New chat** (clears to a fresh draft).
- Per-project compose: **New chat in \<name\>** (sr-only on the folder's pen). Lands on `/draft?projectId=<that project>`.

## Driving it with agent-browser

Prerequisite for the imported-project path: a Project. Ordinary isolated launch already registers `verify-pie-sample`; do not repeat the import flow. That sample is **not** a git repo, so you should see **Not a Git repository** and no worktree picker.

```bash
agent-browser open http://localhost:4190/draft
agent-browser wait --text "Ask Pi anything..."
```

1. Confirm the project picker. Default without `?projectId=` is **Choose project**. Open it: **verify-pie-sample**, then button **Don't work in a project**. Choose the sample for the imported-project path. Re-open: the same button is still last. Click it to clear back to **Choose project**.
2. Click the contenteditable (placeholder **Ask Pi anything...**). `keyboard type` a distinctive prompt, e.g. `verify-pie ping`.
3. Snapshot: submit is now enabled. **Click it** — do not press Enter.
4. Wait for the URL to become `/session/<uuid>?projectId=<uuid>`.

Proof (imported project):

- User bubble shows the exact prompt text.
- Sidebar lists a session titled with that prompt under the project.
- `$PIE_HOME/storage/sessions/<projectId>/<sessionId>.json` exists; `cwd` is the project path; `title` is the prompt. `verify-pie evidence side-effects`.
- Assistant streaming is **optional**. Without `pi` or provider keys, a **Model request failed** card is still a successful create.

Choose project path (`launch --replace --empty-projects`, or leave the picker on **Choose project**):

1. Confirm **Choose project**.
2. Type `allocate ping` and click submit.
3. URL becomes `/session/<uuid>?projectId=<uuid>`.
4. Sidebar **Recent** lists a session titled with the prompt. **Projects** does not list the allocate leaf.
5. That directory exists under `$PIE_HOME/home/Pie/<YYYY-MM-DD>/`. Session `cwd` is that path. `verify-pie evidence side-effects`.

Worktree path (only if the imported folder is a git repo): switch the workspace select to **New worktree**, pick a base branch, send. Create must fail closed on git errors (no session file). Success writes `cwd` under `$PIE_HOME/worktrees/<repo>/<key>/`.

## Gotchas

- CDP Enter does **not** submit. Click the arrow button. Draft submit has **no aria-label** — identify it as the composer submit after the field is non-empty.
- Send is disabled when: input empty, workspace unavailable, create in flight, or worktree mode with no base branch. It is **not** disabled for Choose project.
- Model select missing ≠ broken draft. Pi unavailable ⇒ empty list ⇒ component returns `null`.
- After adding/renaming routes, load `/` through Vite before typechecking (`routeTree.gen.ts` is plugin-generated).
- Verify sets `HOME=$PIE_HOME/home`, so `~/Pie` means `$PIE_HOME/home/Pie` in an isolated run.
