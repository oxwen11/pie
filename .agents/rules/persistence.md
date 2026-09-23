# Host writes and persistence

## Host-write design gate

Adding or changing writes on the user's host is a Developer decision. This
includes application data, browser storage/cookies, Electron profiles/caches,
logs, lifecycle files, worktrees/repository state, and delegated tool writes.

Before proposing a design or implementation plan, read the
[host persistence inventory](../../docs/host-persistence.md) and
confirm with the Developer:

1. Owner, exact location, scope, and override rules.
2. Data structure, sensitivity, permissions, atomicity, and concurrency.
3. Extension strategy, backward compatibility, and rollback compatibility.
4. Migration/adoption, corrupt/newer-data handling, retention, cleanup, and uninstall.

Do not defer these decisions to implementation. Update the inventory in the same
slice as any host-write change.

## Existing contracts

- `packages/server/src/config/paths.ts` owns persistent roots. Derive daemon and
  log paths from it; do not introduce independent defaults.
- One active daemon/writer per `$PIE_HOME`; lifecycle state is in `$PIE_HOME/daemon`.
  Logs belong in `$PIE_HOME/logs` (directory `0700`, files `0600`). Other storage
  formats, ownership, and permissions are specified in the inventory.
- Keep Pie data, daemon lifecycle state, browser/Electron state, and Pi-owned
  state distinct. Deleting Pie metadata does not imply deleting user files or
  Pi transcripts.
- Tests and verification must use an isolated `$PIE_HOME`, never `~/.pie`,
  `~/.pie_dev`, or `~/.pie_<branch>`.
