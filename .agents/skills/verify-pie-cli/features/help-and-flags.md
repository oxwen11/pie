# Help and flags

The CLI is Effect `Command`. `--help` / `-h` and `--version` must work without a daemon. `--port`, `--cors-origin`, and `--allowed-host` are the same flags on `pie`, `pie daemon`, and `pie serve`.

## How to get to it

A current run is optional for `--help` / `-h` / `--version` / `-v`. Other `pie-verify cli run …` args require a launched run (the wrapper refuses rather than guessing a home).

```bash
pnpm exec pie-verify cli run --help
pnpm exec pie-verify cli run daemon --help
pnpm exec pie-verify cli run --version
```

## Driving it

Proof:

- `--help` lists `daemon`, `serve`, and `run`.
- `daemon --help` lists `start`, `stop`, `status`. Bare `pie daemon` still shows `--port` / `--cors-origin` / `--allowed-host`; `daemon stop` and `daemon status` do not.
- `--version` prints `pie v<version>` from `packages/pie/package.json`.
- After `launch`, `pnpm exec pie-verify cli run nosuchcommand` exits non-zero with `Unknown subcommand` and does not spawn a second listener. Without a current run that same wrapper command fails with `no current run. Launch first.`

`--port` on a first start must match `daemon.pid` address. `--port` on reuse is ignored (see [daemon-reuse.md](daemon-reuse.md)).
