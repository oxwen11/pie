# Import project (desktop)

Same SPA flow as `.cursor/skills/verify-pie/features/import-project.md`. Drive the **Electron renderer** via CDP. Do not `open http://localhost:4190/` and do not `open http://localhost:5173/` (electron-vite's renderer URL after connect) and call that desktop.

## How to get to it

Real launch (not Playwright e2e — e2e seeds a project and uses fake-pi):

```bash
pnpm exec pie-verify desktop launch
pnpm exec pie-verify desktop doctor
```

Empty isolated home: heading **Import your first project**, button **Import project**. Launch creates `$HOME/verify-pie-desktop-sample`.

## Driving it

```bash
eval "$(pnpm exec pie-verify desktop env --export)"
# doctor already attached; if not:
# "$AGENT_BROWSER" --session "$AGENT_BROWSER_SESSION" --cdp "$AGENT_BROWSER_CDP" connect "$AGENT_BROWSER_CDP"
"$AGENT_BROWSER" --session "$AGENT_BROWSER_SESSION" wait --text "Import your first project"
"$AGENT_BROWSER" --session "$AGENT_BROWSER_SESSION" find role button --name "Import project" click
```

Then the same clicks as web verify-pie:

1. **Import project**
2. Type `verify-pie-desktop-sample`, enter that folder
3. **Import this folder**

Proof: sidebar shows the project; `$PIE_HOME/storage/projects.json` envelope `{ version: 1, data: [...] }` has `name: verify-pie-desktop-sample`. Use `verify-pie-desktop evidence side-effects`.

CDP Enter does not submit TipTap. This feature does not need send.
