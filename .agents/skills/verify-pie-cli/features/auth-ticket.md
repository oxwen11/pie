# Auth ticket

The daemon always sets `PIE_AUTH_TOKEN`. `GET /api/health` stays open. `POST /api/ws-ticket` is the gate.

## How to get to it

Any healthy daemon launch. Doctor already checks this; a dedicated proof repeats it into evidence.

```bash
.cursor/skills/verify-pie-cli/bin/verify-pie-cli evidence curl
```

## Driving it

Proof (daemon mode):

- No `Authorization` → HTTP 401.
- `Authorization: Bearer <token from daemon.pid>` → HTTP 200.
- Wrong bearer → not 200.

Do not write the token into `curl.txt` beyond the fact that a bearer header was sent. Evidence copies `daemon.pid` with `token` redacted.

Foreground `pie serve` is the opposite: ticket 200 with no token. That belongs to [serve-foreground.md](serve-foreground.md).
