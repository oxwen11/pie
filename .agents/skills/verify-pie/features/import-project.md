# Import project

Register a local folder as a **Project**. The server stores `{ id, name, path, createdAt }` in `$PIE_HOME/storage/projects.json`. `name` is the folder basename. Sessions always resolve their working directory through a Project — there is no caller-supplied cwd on the wire.

## Sub-features

- **Empty-state import** — no projects yet. `/draft` is a centered empty: heading **Import your first project**, button **Import project**.
- **Sidebar import** — at least one project exists. **Import project** is the plus-folder action on the **Projects** group (`<span class="sr-only">Import project</span>`).
- **Folder browser** — command dialog starts at `os.homedir()`. Click a row to drill in (`..` goes up). Hidden/dot folders stay hidden unless the query starts with `.`. `node_modules` is never listed.
- **Import this folder** — creates (or returns the existing) Project for the path shown in the footer, then closes. Empty-state import also navigates to `/draft?projectId=<id>`.

## How to get to it (user POV)

1. Open `http://localhost:4190/` — lands on `/draft`.
2. If the isolated home is empty: click **Import project** in the empty state.
3. If projects already exist: click **Import project** on the sidebar Projects header.
4. In the dialog, move to the folder you want. Launch creates `$HOME/verify-pie-sample` for this (scaffolding).
5. Click **Import this folder**.

## Driving it with agent-browser

```bash
verify-pie doctor
agent-browser open http://localhost:4190/
# wait for empty heading or the draft composer — not the root-route flash
agent-browser snapshot
```

Empty home:

1. Snapshot must show **Import your first project** and **Import project**. Card heading is **New chat**.
2. Click **Import project**.
3. Snapshot: textbox **Search folders or enter a full path...**, list of home directories, footer path = `$HOME`, button **Import this folder**.
4. Type `verify-pie-sample` in the search box (filters current listing by label or full path). Click the **verify-pie-sample** row to **enter** it — do not import `$HOME`.
5. Footer path must end with `verify-pie-sample`. **Import this folder** is enabled only when the listing is not a placeholder from the previous path.
6. Click **Import this folder**.

Proof (all of these):

- Dialog is gone.
- Draft composer is visible: placeholder **Ask Pi anything...**, project picker shows `verify-pie-sample` (not **Select a project**).
- URL is `/draft?projectId=<uuid>` (model search params may appear once `listModels` returns).
- Sidebar **Projects** lists **verify-pie-sample**.
- `$PIE_HOME/storage/projects.json` `data[]` has `name: "verify-pie-sample"` and `path` equal to that folder. Use `verify-pie evidence side-effects`.

Sidebar path (after one project exists): same dialog, opened from the Projects group action named **Import project**. Importing the same folder again must not duplicate the row (server dedupes on path).

## Gotchas

- Typing a full path only **filters** the current listing. It does not `cd`. Click the folder, then import.
- **Import this folder** stays disabled while `keepPreviousData` still shows the previous directory (`isPlaceholderData`).
- `node_modules` and (by default) dot-directories are absent from the list.
- Do not import the repo root as a convenience unless that is the feature under test — it pollutes the isolated home with a real tree and makes later proofs harder to read.
- This path does not need `pi` or model credentials.
