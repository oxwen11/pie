# @getpie/app

The pie SPA. Desktop mounts `PlatformProvider` + `AppInterface` from the root
export; the browser talks to `pie serve`, which hosts this package's `dist`.

## Development

Dev is two processes (Vite on 4190, `pie serve` on 4180). See
`.agents/skills/verify` for the launch recipe.

```bash
pnpm turbo run dev --filter=@getpie/app
```

## End-to-end tests

Playwright drives the **built** SPA that `pie serve` already hosts
(`apps/app/dist`), not the Vite dev server. The `e2e` turbo task
`dependsOn: ["build"]` so dist exists. The server uses
`tools/testing/fake-pi.mjs` — no model API keys.

```bash
# from the repo root
pnpm turbo run e2e --filter=@getpie/app
```

First time on a machine, install Chromium for this package (not a global
Playwright install):

```bash
cd apps/app && pnpm exec playwright install chromium
```

Headed / last HTML report:

```bash
pnpm turbo run e2e:headed --filter=@getpie/app
pnpm turbo run e2e:report --filter=@getpie/app
```

This suite is not in quality CI. Quality runs on a single self-hosted runner
and already excludes desktop Electron e2e; a long browser job is not bolted
onto that one job until the suite is measured hermetic there.
