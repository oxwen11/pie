# @getpie/verify

Workspace toolchain for isolated Pie proofs. Installed at the repo root as a
`devDependency`. The command every verify skill calls is **`pie-verify`**.

This is **not** `@getpie/cli` (`packages/pie`, bin `pie`). That is the product
CLI.

| Surface   | Skill recipe                        | Isolation                                                               |
| --------- | ----------------------------------- | ----------------------------------------------------------------------- |
| `web`     | `.agents/skills/verify-pie`         | Vite **4190** + foreground `pie serve` **4180**, `/tmp/pie-verify-web/` |
| `cli`     | `.agents/skills/verify-pie-cli`     | `pie` / `pie daemon` / `pie serve` on **4182**, `/tmp/pie-verify-cli/`  |
| `desktop` | `.agents/skills/verify-pie-desktop` | Electron + token daemon, CDP **9223**, `/tmp/pie-verify-desktop/`       |

```bash
pnpm exec pie-verify web launch
pnpm exec pie-verify web doctor
pnpm exec pie-verify web browser open
pnpm exec pie-verify web browser snapshot
pnpm exec pie-verify web cleanup

pnpm exec pie-verify cli launch
pnpm exec pie-verify cli doctor
pnpm exec pie-verify cli run daemon status
pnpm exec pie-verify cli cleanup

pnpm exec pie-verify desktop launch
pnpm exec pie-verify desktop doctor
pnpm exec pie-verify desktop browser snapshot
pnpm exec pie-verify desktop cleanup
```

`web browser` / `desktop browser` run the mise-managed `agent-browser`
(`aqua:vercel-labs/agent-browser`, not a pnpm dep) with the isolated session
(`pie-verify-web` / `pie-verify-desktop`) and, on desktop, the run's CDP port.
`cli` has no page.

Cold-start recipes and feature maps stay in the skill trees
(`.cursor/skills/verify-pie*` are symlinks). Shared process/HTTP/JSON helpers
are `@getpie/verify/runtime`. Launch/doctor/cleanup/evidence orchestration is
one lifecycle; each surface only supplies spawn, probe, and stop.
Loopback health/ticket/warmup use `node:http` and try `[::1]` so Vite's
IPv6-only 4190 is reachable when global `fetch` is intercepted or `localhost`
is IPv4.

**Not Bun.** Pie, the daemon, `tsx`, and Electron's Node side are Node 24.
