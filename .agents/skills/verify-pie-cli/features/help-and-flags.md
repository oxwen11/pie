# Help and flags

The CLI is Effect `Command`. `--help` / `-h` and `--version` must work without a daemon. `--port`, `--cors-origin`, and `--allowed-host` are the same flags on `pie`, `pie daemon`, and `pie serve`.

## How to get to it

A current run is optional for `--help`. Prefer `verify-pie-cli run` so Node 24 and the repo CLI are used.

```bash
.cursor/skills/verify-pie-cli/bin/verify-pie-cli run --help
.cursor/skills/verify-pie-cli/bin/verify-pie-cli run daemon --help
.cursor/skills/verify-pie-cli/bin/verify-pie-cli run --version
```

## Driving it

Proof:

- `--help` lists `daemon` and `serve`.
- `daemon --help` lists `start`, `stop`, `status`.
- `--version` prints the package version from `packages/pie/package.json`.
- Unknown commands fail without spawning a daemon on 4000.

`--port` on a first start must match `daemon.pid` address. `--port` on reuse is ignored (see [daemon-reuse.md](daemon-reuse.md)).
