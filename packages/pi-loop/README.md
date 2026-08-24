# @getpie/pi-loop

Session-scoped `/loop` for a long-running Server Pi process. Fires with
`sendMessage({ customType: "@getpie/pi-loop" }, { triggerTurn: true })` so a UI
can render a loop card instead of a user bubble.

In-memory only. Tasks disappear on process exit, `/reload`, `/new`, `/resume`,
and `/fork`. There is no restart recovery.

```bash
pi --mode rpc --no-session -e ./packages/pi-loop
```

Then `/loop 5m check the deploy` (fixed cron) or `/loop check whether CI passed`
(dynamic; the model calls `schedule_wakeup`).

```bash
turbo run typecheck --filter=@getpie/pi-loop
turbo run test --filter=@getpie/pi-loop
```

Known limits: no persistence, no queue revoke, no loop-scoped abort of work
already sent to the model. Missed ticks coalesce to one run. Dynamic loops that
miss `schedule_wakeup` twice stop after a 20-minute fallback.
