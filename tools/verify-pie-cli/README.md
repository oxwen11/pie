# @getpie/verify-pie-cli

Workspace toolchain for isolated `pie` / `pie daemon` / `pie serve` proofs.

This is **not** `@getpie/cli` (`packages/pie`, bin `pie`). That is the product
CLI. This package is the Node >= 24 helper that launches an isolated home on
port **4182**, doctors it, drives `tsx src/node/cli.ts`, and cleans up.

The cold-start recipe and feature map live in
`.agents/skills/verify-pie-cli` (`.cursor/skills/verify-pie-cli` is a
symlink). Shared process/HTTP/JSON helpers are
`@getpie/verify-pie-cli/runtime` (used by the web and desktop verify skills).
Loopback health/ticket use `node:http` and try `[::1]` so Vite's IPv6-only
4190 is reachable when global `fetch` is intercepted or `localhost` is IPv4.

**Not Bun.** Pie, the daemon, `tsx`, and Electron's Node side are Node 24.

```bash
pnpm exec verify-pie-cli launch
pnpm exec verify-pie-cli doctor
pnpm exec verify-pie-cli run daemon status
pnpm exec verify-pie-cli cleanup
```

The skill bin `.cursor/skills/verify-pie-cli/bin/verify-pie-cli` is a thin
wrapper that finds Node 24 and execs this package.
