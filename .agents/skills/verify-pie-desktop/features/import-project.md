# Import project (desktop)

Same SPA flow as `.cursor/skills/verify-pie/features/import-project.md`. Drive the **Electron renderer** via CDP. Do not `open http://localhost:4190/` and do not `open http://localhost:5173/` (electron-vite's renderer URL after connect) and call that desktop.

## How to get to it

Real launch (preferred product proof). Playwright also covers empty-home Import in `apps/desktop/e2e/tests/import-project.spec.ts` (no seeded projects, browse root confined):

```bash
pnpm exec pie-verify desktop launch --replace --empty-projects
pnpm exec pie-verify desktop doctor
```

`--empty-projects` is reserved for this import proof. `/draft` shows the composer with **Choose project** while still creating `$PIE_HOME/workspace/verify-pie-desktop-sample`; import is the sidebar **Import project** action. The picker is confined to `$PIE_HOME/workspace`. Allocate uses `$PIE_HOME/new-projects`.

## Driving it

```bash
# doctor already attached; if not: agent-browser connect 9223
agent-browser wait --text "Ask Pi anything..."
agent-browser find role button --name "Import project" click
```

Then the same clicks as web verify-pie:

1. **Import project**
2. Type `verify-pie-desktop-sample`, enter that folder
3. **Import this folder**

Proof: sidebar shows the project; `$PIE_HOME/storage/projects.json` envelope `{ version: 1, data: [...] }` has `name: verify-pie-desktop-sample`. Use `verify-pie-desktop evidence side-effects`.

CDP Enter does not submit TipTap. This feature does not need send.
