# User preferences use bare, page-namespaced JSON

Pie-owned preferences live in `$PIE_HOME/settings.json`, separate from Pi's own
settings, process environment, and Electron host state. Use a human-readable
bare object rather than the versioned record envelope used by application storage.

## Decision

```json
{
  "appearance": {
    "theme": "system"
  }
}
```

Root keys name settings pages, not process owners. Add fields within the page or
a new page only when needed; do not introduce empty namespaces, `ui.theme`, or
one combined file for server, renderer, and Desktop state.

The server owns writes, with Effect Schema validation, a process-local semaphore,
and atomic temp-file rename. A missing file returns defaults without creating it;
the first save writes it. Invalid known values or corrupt/unreadable JSON fail
without reset. Unknown fields are discarded on save. A breaking format can add a
sibling version field later; it does not justify an envelope today.

`pie:theme` remains an origin-local FOUC cache. After connection, server settings
are authoritative. Desktop Main may read the same preference for its initial
window background but is not a second writer. Window geometry stays in Electron
host storage; model/agent configuration stays with Pi.

This replaces the earlier TOML / multi-owner settings proposal. See the
[persistence inventory](../host-persistence.md) for the current write contract.
