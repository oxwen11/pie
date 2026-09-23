# Pie owns session metadata; Pi owns conversation history

Session lists must remain useful without opening an agent process or querying an
agent index for every row. Pie therefore persists its own display and recovery
metadata; Pi remains authoritative for the transcript.

## Decision

- Address a session by the complete `{ projectId, sessionId }` SessionRef.
  `agentSessionId` is internal Pi identity, not a wire key.
- Persist metadata under `$PIE_HOME/storage/sessions/<projectId>/<sessionId>.json`.
  List reads use these records, supplemented by live runtime status, rather than
  a per-session backend query.
- Persist `cwd` at creation. The registered Project or server-created worktree
  determines it; agent metadata must not overwrite it. Backfill only when absent.
- Own titles in Pie: the first prompt provides a fallback, and explicit rename
  updates the record. Publish collection events so other clients converge.
- Do not duplicate Pi's transcript in a Pie event database or treat session
  deletion as permission to delete Pi history or workspace files.

## Why not the original overlay proposal?

The original multi-agent design proposed reconciling agent titles and recency
into Pie's storage. Its implementation notes subsequently chose self-owned
fields: agent summaries were not consistently better than the first prompt,
while index queries added cost and lifecycle coupling. Pie is now Pi-only;
that unused overlay is not a requirement to rebuild.

A future external-session import or agent-derived title needs its own explicit
read/reconciliation design, not a return to backend fan-out during `list`.

See the [persistence inventory](../host-persistence.md) for current fields and
write points, and [ADR 0009](0009-pi-session-runtime-and-recovery.md) for runtime ownership.
