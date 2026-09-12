# Daemon compatibility

The daemon discovery record carries an optional, non-secret `compatibilityKey`.
Launchers require one exact key: a healthy daemon is reused only when its record
matches; a missing, malformed, or different key is replaced while holding the
daemon launch lock. The auth `token` remains a separate secret and is used to
prove daemon ownership before replacement signals a recorded pid.

Current builds use `githash:<8-hex>`. Desktop Electron Vite, the standalone
server tsdown config, and the CLI tsdown config each call the shared
`@getpie/core/compatibility` resolver and statically inject the complete
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
transaction at `daemon.lock`. Process exit releases the transaction through the
SQLite connection lifecycle, so lock recovery never deletes a pathname that a
successor may already own.

Development and packaged builds share one daemon per `$PIE_HOME` at
`$PIE_HOME/daemon`. An installed binary uses `~/.pie`; a binary running from
a Git checkout uses `~/.pie_<branch>`. Isolation is a different home, not a
second lifecycle directory. Tests and verify runs must set their own
`$PIE_HOME`.

A future cross-build compatibility protocol can add a separate versioned key
format. Current decoding deliberately accepts only `githash:<8-hex>`.
