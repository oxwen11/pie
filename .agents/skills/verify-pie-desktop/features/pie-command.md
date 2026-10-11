# Install the pie command

Settings → **Command line** links `~/.local/bin/pie` to the packaged app's
`Contents/Resources/bin/pie` and, when needed, appends one marked PATH line to
the login shell's startup file. The section exists only in a **packaged macOS
build**, so `pie-verify desktop launch` (electron-vite dev) cannot reach it.

## How to get to it

Install writes under `$HOME`, so isolate `HOME`, not only `$PIE_HOME`. Copy the
app outside the Git checkout so both the app and its `pie` pick `~/.pie` under
that `HOME`, as an installed app does.

```bash
pnpm exec turbo run build:unpack --filter=@getpie/desktop
E=/tmp/pie-e2e-cli; mkdir -p $E/home $E/Applications
ditto apps/desktop/release/mac-arm64/Pie.app $E/Applications/Pie.app
nohup env -i HOME=$E/home USER=$USER SHELL=/bin/zsh TMPDIR=$TMPDIR \
  PATH=/usr/bin:/bin:/usr/sbin:/sbin PIE_REMOTE_DEBUG_PORT=9241 PIE_DESKTOP_BACKGROUND=1 \
  "$E/Applications/Pie.app/Contents/MacOS/Pie" > $E/electron.log 2>&1 < /dev/null &
```

`env -i` mimics a Dock launch. Drive the renderer with the mise `agent-browser`
binary and `--cdp 9241` on a fresh `--session` (the repo shim pins Verify's port).
A "new terminal" is `env -i HOME=$E/home SHELL=/bin/zsh PATH=/usr/bin:/bin zsh -lic '…'`.

## Driving it

Proof:

- Before: `command -v pie` fails; Settings shows **Install** and says it will add `~/.local/bin` to PATH.
- Install: `~/.local/bin/pie` is a symlink to the app's `bin/pie`; `.zshrc` gains one `# Added by Pie Desktop` line, not duplicated by a second install.
- New terminal: `pie daemon status` reports the desktop's daemon pid from `~/.pie/daemon/daemon.pid`; `pie project create .` appears in the desktop sidebar.
- Uninstall removes only the link; `command -v pie` fails again.
- A regular file at `~/.local/bin/pie` shows the conflict inline, disables Install, and is never overwritten.
- With the app quit and `pie daemon stop`, `pie ls` starts the daemon as `Pie Helper … app.asar/…/@getpie/server/dist/server.js`; relaunching the app attaches to that pid.

Cleanup: quit the app, `pie daemon stop` in that `HOME`, then remove `$E`. Never run Install against your real `HOME`.
