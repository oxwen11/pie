# Import project

Register a local folder as a **Project**. The server stores `{ id, name, path, createdAt }` in `$PIE_HOME/storage/projects.json`. `name` is the folder basename. Sessions always resolve their working directory through a Project — there is no caller-supplied cwd on the wire. Starting a chat without importing is **Choose project** on `/draft` (`project.allocate`); this file is only the import path.

## Sub-features

- **Sidebar import** — the plus-folder action on the **Projects** group (`<span class="sr-only">Import project</span>`). Present even when the home is empty. `/draft` with zero projects still shows the composer (picker **Choose project**), not a blocking empty.
- **Folder browser** — Verify confines the command dialog to `$PIE_HOME/workspace`; production Pie still starts at `os.homedir()`. Click a row to drill in. The Verify root has no `..`, and real-path checks reject paths and symlinks outside it. Hidden/dot folders stay hidden unless the query starts with `.`. `node_modules` is never listed.
- **Import this folder** — creates (or returns the existing) Project for the path shown in the footer, then closes. Sidebar import refreshes the list; it does not write `?projectId=`.

## How to get to it (user POV)

1. Start a fresh empty run with `pnpm exec pie-verify web launch --replace --empty-projects`, then open `http://localhost:4190/` — lands on `/draft` with **Choose project**.
2. Click **Import project** on the sidebar Projects header.
3. In the dialog, enter the `$PIE_HOME/workspace/verify-pie-sample` folder created by launch.
4. Click **Import this folder**.

## Driving it with agent-browser

```bash
pnpm exec pie-verify web launch --replace --empty-projects
pnpm exec pie-verify web doctor
agent-browser open http://localhost:4190/
# wait for the draft composer — not a first-project empty heading
agent-browser wait --text "Do Anything, / for skills, @ for context"
agent-browser find role button --name "Import project" click
agent-browser wait --text "Import this folder"
```

Empty home:

1. Snapshot must show the draft composer (**Do Anything, / for skills, @ for context**, picker **Choose project**). Card heading is **New chat**. There is no **Import your first project** heading.
2. Click sidebar **Import project**.
3. Snapshot: textbox **Search folders or enter a full path...**, only the isolated sample directory, footer path = `$PIE_HOME/workspace`, button **Import this folder**.
4. Type `verify-pie-sample` in the search box (filters current listing by label or full path). Click the **verify-pie-sample** row to **enter** it — do not import `$HOME`.
5. Footer path must end with `verify-pie-sample`. **Import this folder** is enabled only when the listing is not a placeholder from the previous path.
6. Click **Import this folder**.

Proof (all of these):

- Dialog is gone.
- Draft composer is visible: placeholder **Do Anything, / for skills, @ for context**. The project picker still says **Choose project** until you choose the imported row (sidebar import does not write `?projectId=`).
- Sidebar **Projects** lists **verify-pie-sample**.
- `$PIE_HOME/storage/projects.json` `data[]` has `name: "verify-pie-sample"` and `path` equal to that folder. Use `verify-pie evidence side-effects`.

Importing the same folder again must not duplicate the row (server dedupes on path).

## Gotchas

- Typing a full path only **filters** the current listing. It does not `cd`. Click the folder, then import.
- **Import this folder** stays disabled while `keepPreviousData` still shows the previous directory (`isPlaceholderData`).
- `node_modules` and (by default) dot-directories are absent from the list.
- Do not import the repo root as a convenience unless that is the feature under test — it pollutes the isolated home with a real tree and makes later proofs harder to read.
- This path does not need `pi` or model credentials.
