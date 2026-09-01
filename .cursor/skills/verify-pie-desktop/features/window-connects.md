# Window connects

The desktop window must leave the splash and talk to the isolated daemon. Title **Pie**. `#root` visible. No **Pie could not start**.

## Sub-features

- **Splash** — `aria-label="Starting Pie"` (`<main>`). Unmounts after the first successful server connection.
- **Connected shell** — same draft / sidebar as web once the splash is gone.
- **CDP** — `agent-browser --session verify-pie-desktop connect <PIE_REMOTE_DEBUG_PORT>` attaches to the window.

## Scripted path (Playwright, test mode)

`apps/desktop/e2e/tests/desktop-rpc.spec.ts` — "renders in the background without taking focus and connects to the server".

This is **E2E mode**: `PIE_E2E=1`, fake-pi, hidden window on darwin, seeded `projects.json` via fixtures. Green here proves connect + no startup dialog. It does **not** prove Import project against a real folder.

```bash
cd apps/desktop && pnpm e2e -- desktop-rpc.spec.ts -g "renders in the background without taking focus and connects to the server"
```

`pnpm e2e` goes through turbo and builds `@getpie/desktop` first (`apps/desktop/turbo.json`). Do not bypass turbo.

## Real isolated window

```bash
.cursor/skills/verify-pie-desktop/bin/verify-pie-desktop launch
.cursor/skills/verify-pie-desktop/bin/verify-pie-desktop doctor
.cursor/skills/verify-pie-desktop/bin/verify-pie-desktop evidence init
```

Doctor attaches with `agent-browser connect`. Then:

```bash
agent-browser --session verify-pie-desktop snapshot
```

Snapshot must not show **Pie could not start**. After connect, splash `Starting Pie` is gone. Title is **Pie**.

Proof (real launch): doctor OK (agent-browser attached) + snapshot without the failure dialog. Playwright list output is enough for the scripted path; say it was E2E.
