# Daemon compatibility

The daemon discovery record carries an optional, non-secret `compatibilityKey`.
Launchers require one exact key: a healthy daemon is reused only when its record
matches; a missing, malformed, or different key is replaced while holding the
daemon launch lock. The auth `token` remains a separate secret and is used to
prove daemon ownership before replacement signals a recorded pid.

Current builds use `githash:<8-hex>`. Desktop Electron Vite, the standalone
server tsdown config, and the CLI tsdown config each call the shared
`@getpie/core/build-id` resolver and statically inject the complete
`PIE_DAEMON_COMPATIBILITY_KEY` string into their output. Runtime code only
validates that embedded value; there is no `dev` fallback.

A clean checkout uses the first eight hexadecimal characters of `git rev-parse
HEAD`. A dirty checkout hashes HEAD plus tracked and untracked changes under
the core, server, CLI, and Desktop Main build inputs through `git hash-object`,
so rebuilding changed daemon/Main source
cannot silently reuse a daemon from the prior worktree state. The three build
tasks that embed this value are intentionally uncached in Turbo: a cache hit
would skip config evaluation and could restore an artifact carrying an older
Git identity. `@getpie/core` itself has an ordinary cached build output.

Launch, attach, replacement, and stop decisions hold an OS-backed SQLite write
transaction at `daemon.lock.v2`. During the transition from older builds, the
same owner also holds a live PID-only `daemon.lock` sentinel, so old and new
launchers exclude each other. A stale or malformed legacy sentinel is never
automatically unlinked: portable filesystem APIs cannot condition an unlink on
the file identity, so automatic reclamation could delete a concurrently created
old-launcher successor. Startup instead fails with instructions to close older
Pie launchers, remove that stale file, and retry.

Development Desktop runs isolate only lifecycle state. Unless
`PIE_DAEMON_DIR` is explicitly set, Main derives a stable scope from the
canonical Git checkout path and uses `$PIE_HOME/daemons/<scope>` (or
`~/.pie-dev/daemons/<scope>` with the normal development default). Project and
Session storage, application ports, and root development commands are
unchanged. Packaged builds continue sharing `~/.pie/daemon/`.

When cross-build compatibility becomes stable, key generation can switch to
`protocol:<positive-integer>`. Record decoding and launcher matching remain
exact and require no lifecycle changes.
