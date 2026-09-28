# One discoverable daemon per Pie home

Desktop and CLI must not independently launch writers against the same storage.
They attach to or start one daemon per `$PIE_HOME`; changing the home, not adding
another lifecycle directory, is the isolation boundary.

## Decision

- Keep discovery and lifecycle state under `$PIE_HOME/daemon`. The discovery
  record contains the process/address, auth token, and optional compatibility key.
- Serialize launch, attach, replacement, and stop decisions with the OS-backed
  SQLite write transaction at `daemon.lock`. Process exit releases ownership;
  never unlink a lock pathname to recover it.
- Reuse a healthy local daemon only when its compatibility key exactly matches.
  Prove ownership using the separate auth token before signalling a recorded
  process for replacement. A compatibility key is not an authentication secret.
- Desktop exit leaves the resident daemon running. An SSH disconnect closes the
  local tunnel, not the remote daemon.
- SSH launch prefers an already-healthy remote daemon. A missing or mismatched
  remote key fails the connection; it does not silently connect incompatible
  clients or replace the remote installation.

## Build identity

Current builds embed `githash:<8-hex>` through the shared
`@getpie/core/compatibility` resolver. A clean checkout uses HEAD; a dirty build
hashes HEAD plus the tracked and untracked daemon/Main build inputs. Desktop,
server, and CLI evaluate the same resolver, and their embedding build tasks are
uncached so an old artifact cannot silently reuse a new worktree's daemon.
Runtime validation has no generic `dev` fallback. A future cross-build protocol
needs an explicit versioned compatibility scheme rather than weakening equality.

## Remote transport

Desktop SSH uses the local OpenSSH client and a loopback tunnel. A Tailscale
MagicDNS name is an SSH target, not a replacement for OpenSSH. Tokens stay
separate from saved host identity. Additional access paths do not create another
daemon identity; routing belongs to [ADR 0005](0005-environment-rpc-routing.md).

The [persistence inventory](../host-persistence.md) owns exact paths,
permissions, home overrides, and retention. The [remote verification guide](../remote-access-verification.md)
describes how to prove transport isolation without relying on old machine addresses.
