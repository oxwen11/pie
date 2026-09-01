# Foreground serve

`pie serve` is the process manager / container / web-verify server. It does **not** write `daemon.pid` and does **not** require a token. Closing the process stops the server.

## How to get to it

```bash
.cursor/skills/verify-pie-cli/bin/verify-pie-cli launch --serve
.cursor/skills/verify-pie-cli/bin/verify-pie-cli doctor
```

Do not mix `--serve` with an existing daemon run on the same current pointer. `--replace` first.

## Driving it

```bash
curl -fsS http://127.0.0.1:4182/api/health    # ok
curl -sS -o /dev/null -w '%{http_code}' -X POST http://127.0.0.1:4182/api/ws-ticket
# 200 — browser mode, same as verify-pie web
```

Proof:

- Doctor reports `mode serve` and ticket 200 with no token.
- `daemon.pid` is absent (or leftover from a previous mode — should not be after `--replace`).
- Killing the recorded serve pid (cleanup) frees the port.

This is what `.cursor/skills/verify-pie` starts as `packages/pie && pnpm dev`. Use this skill when the change is the CLI entry, flags, or serve vs daemon split — not the Vite UI.
