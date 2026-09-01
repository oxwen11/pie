# Content panel

The column beside chat (`ContentPanel`). One app-wide host; tabs are per session ref. Off a session the panel is hidden and **Toggle content panel** is not rendered.

## Sub-features

- **Toggle** — shell-fixed button, `aria-label="Toggle content panel"`, `aria-pressed` when not hidden. Card header leaves a spacer so the button can sit on the chrome.
- **Empty body** — **Choose what to show alongside the chat.** plus ghost buttons for each openable type.
- **Tab strip** — one strip for all open panels. **Open a panel** (`+`) adds another. **Close \<label\>**. **Maximize panel** / **Restore panel size**.
- **Files** — workspace tree, `aria-label="Project files"`. Clicking a file **replaces** the Files tab with a **File** family tab (label = basename, `title: "File"`) — one tab, not two. Empty-tree chrome may be Chinese (`打开文件`).
- **Review** — git change set vs default base; toolbar **Compare mode**, **Reload review**. Needs a git repo.
- **Terminal** / **Browser** — placeholder chrome (`apps/app/src/components/layout/content-panel/panels/README.md`). Terminal greeting is fake `pnpm dev` lines. Browser has **Address** and **Reload**. Do not treat their output as a real shell or network.

## How to get to it (user POV)

1. Open any `/session/<id>`.
2. Click **Toggle content panel**.
3. Pick **Files** / **Review** / **Terminal** / **Browser**, or use **Open a panel** after the first tab exists.

## Driving it with agent-browser

```bash
# on a session route
agent-browser snapshot
# click Toggle content panel
agent-browser snapshot
```

1. Pressed toggle; complementary/`data-slot="content-panel"` is in the tree (or the empty copy is visible). Hidden unmounts the column — it is not merely CSS-hidden.
2. Click **Files**. Tab label **Files**. Tree named **Project files** lists the imported folder's files (`README.md` in `verify-pie-sample`).
3. Click `README.md` if shown — the **Files** tab **becomes** **README.md** (File family). Preview is the file text.
4. **Toggle content panel** again unmounts the column; chat and URL remain.

Proof: snapshots before / open / Files / File / hidden, plus the session URL unchanged. Files is the real feature; Terminal/Browser only prove the host (tab appears, close works).

Review: on a **non-git** sample, the Review tab shows **Not a Git repository** / **Open a Git project to review uncommitted work, commits, or another branch.** Git diff tree / Compare mode / Reload need an imported git project — do not import the repo root as a convenience.

## Gotchas

- Toggle is absent on `/draft`. That is correct.
- **File** in the empty-state grid may be missing: it is a family that needs a path. Open files from the Files tree.
- Panel instance state (terminal scrollback, browser loading) dies on **Close \<label\>**, not on hide. Hide then show should restore tabs; close should not.
- Persistence is per session ref. A different session starts empty.
- Placeholder Terminal does **not** run commands in the project. A "proof" that types into **zsh N input** and expects repo side effects is wrong.
