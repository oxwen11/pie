# Window connects

The desktop window must leave the splash and talk to the isolated daemon. Title **Pie**. `#root` visible. No **Pie could not start**.

## Sub-features

- **Splash** — `aria-label="Starting Pie"` (`<main>`). Unmounts after the first successful server connection **and** the ~1s startup animation (`prefers-reduced-motion` skips the delay).
- **Connected shell** — same draft / sidebar as web once the splash is gone.
- **CDP** — `agent-browser --session verify-pie-desktop connect <PIE_REMOTE_DEBUG_PORT>` attaches to the window.

## Scripted path (Playwright, test mode)

`apps/desktop/e2e/tests/desktop-rpc.spec.ts` — "renders in the background without taking focus and connects to the server".

This is **E2E mode**: `PIE_E2E=1`, fake-pi, window stays hidden on **all** platforms (darwin also uses accessory activation so it does not steal focus), seeded `projects.json` via fixtures. Green here proves connect + no startup dialog. It does **not** prove Import project against a real folder.

```bash
pnpm turbo run e2e --filter=@getpie/desktop -- desktop-rpc.spec.ts -g "renders in the background without taking focus and connects to the server"
```

`cd apps/desktop && pnpm e2e` runs Playwright **without** the turbo `@getpie/desktop` build. Use the turbo form. The named test proves title / `#root` / no failure text on a **hidden** window; it does not wait for splash dismiss.

## Real isolated window

```bash
pnpm exec pie-verify desktop launch
pnpm exec pie-verify desktop doctor
pnpm exec pie-verify desktop evidence init
```

Doctor attaches with `agent-browser connect`. Then:

```bash
agent-browser --session verify-pie-desktop snapshot
```

Snapshot must not show **Pie could not start**. After connect + animation, splash `Starting Pie` is gone. Title is **Pie**. `get url` may show `http://localhost:5173/…` — that is the renderer origin inside Electron, not a page to open in a separate browser.

Proof (real launch): doctor OK (agent-browser attached) + snapshot without the failure dialog. Playwright list output is enough for the scripted path; say it was E2E.
