# Auth ticket

The daemon always sets `PIE_AUTH_TOKEN`. `GET /api/health` stays open. `POST /api/ws-ticket` is the gate.

## How to get to it

Any healthy daemon launch. Doctor already checks this; a dedicated proof repeats it into evidence.

```bash
pnpm exec pie-verify cli evidence curl
```

## Driving it

Proof:

- No `Authorization` → HTTP 401.
- `Authorization: Bearer <token from daemon.pid>` → HTTP 200.
- Wrong bearer → not 200.

Do not write the token into `curl.txt` beyond the fact that a bearer header was sent. Evidence copies `daemon.pid` with `token` redacted.
