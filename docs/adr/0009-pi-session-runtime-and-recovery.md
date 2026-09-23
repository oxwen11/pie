# One Pi runtime owner, one live consumption path

Pie integrates Pi only. A multi-agent registry and adapter-selection protocol
would add identities and lifecycle owners that the product no longer needs.
Keep one session model and recover from Pi history plus a live snapshot rather
than persisting a second event log.

## Ownership

- `PiAgentSessionService` is the outward SessionRef service: metadata, identity
  translation, input vocabulary, and collection events.
- `PiAgentSessionManager` owns live state and is the sole caller of
  `PiAgent.create` / `resume`. No history reader or router independently spawns
  another runtime for the same session.
- `PiAgent` supplies runtime entry and cold reads.
  `PiAgentRuntime` owns the live Pi child; private session/fold modules own the
  session state and stream bookkeeping.
- `prepare` is cold validation/backfill, not resume. Status/snapshot observation
  must not start a Pi process; prompts or history reads that need a runtime
  acquire it through its owner.
- The daemon runs under Node. The Pie-owned Pi child runs under Bun with the
  packaged Pi SDK, not an independently installed user's `pi` executable.

## Streaming and recovery

- Keep oRPC over WebSocket and one shared EventBus instance. Global collection
  events and per-session events have different scopes; only session events have
  the session sequence used for reconciliation.
- Subscribe before taking a snapshot or prompting. Apply snapshot state and then
  only buffered events beyond its cursor. Live subscriptions are not a durable
  replay service; restart recovery uses authoritative history and fresh state.
- A session with no live runtime reads as idle rather than forcing every client
  to implement a separate resume-on-observation protocol.
- The session owns bounded live buffers and slow-consumer closure. Truncated
  data must not appear complete; recover through history instead of fabricating
  missing chunks or persisting a second transcript.
- Own and remote prompts share the same standing subscription in the client.
  Do not maintain separate prompt-response and observer rendering pipelines.

See [metadata ownership](0002-session-info-storage-floor-harness-overlay.md),
[history folding](0003-pi-history-role-segmentation.md), and the current
[package rules](../../.agents/rules/topics/architecture.md). Environment-bound client
routing is covered separately by [ADR 0005](0005-environment-rpc-routing.md).
