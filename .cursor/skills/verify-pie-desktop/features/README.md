# Feature map

Source of truth for what a pie desktop proof must cover.

Primary surface: Electron window hosting `@getpie/app`. Harness: Playwright e2e (scripted, test mode) or agent-browser via `PIE_REMOTE_DEBUG_PORT`.

| Feature | File | User entry |
| --- | --- | --- |
| Window connects to the daemon | [window-connects.md](window-connects.md) | App launch / splash dismisses |
| Import a local folder | [import-project.md](import-project.md) | Empty draft **Import project** |
| Server status overlay | [server-status-overlay.md](server-status-overlay.md) | Daemon dies or reconnects |
| Attach to an existing daemon | [daemon-attach.md](daemon-attach.md) | Second desktop / CLI with the same `PIE_HOME` |

Web-only Vite proofs belong in `.cursor/skills/verify-pie`. CLI-only daemon proofs belong in `.cursor/skills/verify-pie-cli`.
